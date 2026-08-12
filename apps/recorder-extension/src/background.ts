type RecorderSettings = {
  apiUrl: string;
  projectId: string;
  accessToken: string;
  targetUrl?: string;
  productName?: string;
  studioUrl?: string;
};
type CaptureSession = {
  tabId: number;
  sourceUrl: string;
  title: string;
  startedAt: string;
  startedMs: number;
  events: unknown[];
  viewport: {width: number; height: number; deviceScaleFactor: number};
};

let current: CaptureSession | null = null;

const readSettings = async () => {
  const stored = await chrome.storage.local.get(["scenegraphRecorderSettings", "scenegraphRecorderState"]);
  return {
    settings: stored.scenegraphRecorderSettings as Partial<RecorderSettings> | undefined,
    state: String(stored.scenegraphRecorderState ?? "idle"),
    recording: Boolean(current),
  };
};

const saveSettings = async (settings: Partial<RecorderSettings>) => {
  const existing = (await readSettings()).settings ?? {};
  const next = {
    ...existing,
    ...settings,
    apiUrl: settings.apiUrl?.replace(/\/$/, "") ?? existing.apiUrl ?? "http://localhost:4100",
    accessToken: settings.accessToken ?? existing.accessToken ?? "",
  };
  await chrome.storage.local.set({scenegraphRecorderSettings: next, scenegraphRecorderState: "paired"});
  await chrome.action.setBadgeBackgroundColor({color: "#168fe1"});
  await chrome.action.setBadgeText({text: "SET"});
  setTimeout(() => chrome.action.setBadgeText({text: current ? "REC" : ""}), 1600);
  return next;
};

const requireSettings = async () => {
  const settings = (await readSettings()).settings;
  if (!settings?.apiUrl || !settings.projectId) throw new Error("Pair SceneGraph Capture from Studio first.");
  return {
    ...settings,
    apiUrl: settings.apiUrl,
    projectId: settings.projectId,
    accessToken: settings.accessToken ?? "",
  };
};

const focusStudio = async (settings: Partial<RecorderSettings>) => {
  if (!settings.studioUrl) return;
  const studio = new URL(settings.studioUrl);
  const tabs = await chrome.tabs.query({url: `${studio.origin}/*`}).catch(() => []);
  const tab = tabs.find((candidate) => candidate.id);
  if (tab?.id) {
    await chrome.tabs.update(tab.id, {active: true, url: settings.studioUrl});
    if (tab.windowId) await chrome.windows.update(tab.windowId, {focused: true});
    return;
  }
  await chrome.tabs.create({url: settings.studioUrl});
};

const ensureOffscreen = async () => {
  const exists = await chrome.offscreen.hasDocument();
  if (!exists) {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Record the selected product tab without browser chrome",
    });
  }
};

const ensureTabRecorder = async (tabId: number) => {
  const ping = async () =>
    chrome.tabs
      .sendMessage(tabId, {type: "SCENEGRAPH_PING"})
      .then((response) => Boolean(response?.ok))
      .catch(() => false);

  if (await ping()) return;
  await chrome.scripting.executeScript({
    target: {tabId},
    files: ["dist/content.js"],
  });
  if (!(await ping())) throw new Error("SceneGraph could not prepare this tab for capture. Refresh the product tab and try again.");
};

const startCapture = async (settings: RecorderSettings) => {
  const saved = await saveSettings(settings);
  const merged = {...saved, ...settings};
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab.id || !tab.url) throw new Error("Select the product tab first");
  await ensureOffscreen();
  await ensureTabRecorder(tab.id);
  const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id});
  current = {
    tabId: tab.id,
    sourceUrl: tab.url,
    title: tab.title ?? "Product walkthrough",
    startedAt: new Date().toISOString(),
    startedMs: Date.now(),
    events: [],
    viewport: {
      width: tab.width ?? 1920,
      height: tab.height ?? 1080,
      deviceScaleFactor: 1,
    },
  };
  await chrome.tabs.sendMessage(tab.id, {type: "SCENEGRAPH_START"});
  await chrome.runtime.sendMessage({target: "offscreen", type: "START_RECORDING", streamId});
  await chrome.action.setBadgeBackgroundColor({color: "#E14F3D"});
  await chrome.action.setBadgeText({text: "REC"});
  await chrome.storage.local.set({scenegraphRecorderSettings: merged, scenegraphRecorderState: "recording"});
};

const stopCapture = async (settings: Partial<RecorderSettings>) => {
  if (!current) throw new Error("No recording is active");
  const merged = {...(await requireSettings()), ...settings};
  const tabId = current.tabId;
  await chrome.tabs.sendMessage(tabId, {type: "SCENEGRAPH_STOP"}).catch(() => undefined);
  await chrome.action.setBadgeText({text: "UP"});
  const result = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "STOP_RECORDING",
    apiUrl: merged.apiUrl.replace(/\/$/, ""),
    projectId: merged.projectId,
    accessToken: merged.accessToken,
    captureId: crypto.randomUUID(),
    sourceUrl: current.sourceUrl,
    startedAt: current.startedAt,
    durationMs: Date.now() - current.startedMs,
    viewport: current.viewport,
    events: current.events,
  });
  current = null;
  await chrome.action.setBadgeText({text: ""});
  await chrome.storage.local.set({scenegraphRecorderState: result.ok ? "uploaded" : "failed"});
  await chrome.tabs.sendMessage(tabId, {type: "SCENEGRAPH_CAPTURE_DONE", ok: result.ok, error: result.error}).catch(() => undefined);
  if (!result.ok) throw new Error(result.error);
  await focusStudio(merged).catch(() => undefined);
  return result;
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "SCENEGRAPH_EVENT" && current && sender.tab?.id === current.tabId) {
    current.events.push(message.event);
    return;
  }
  if (message.target === "background" && message.type === "START_CAPTURE") {
    startCapture(message.settings).then(() => sendResponse({ok: true})).catch((error) => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message.target === "background" && message.type === "STOP_CAPTURE") {
    stopCapture(message.settings).then(sendResponse).catch((error) => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message.target === "background" && message.type === "STOP_ACTIVE_CAPTURE") {
    requireSettings()
      .then((settings) => stopCapture(settings))
      .then(sendResponse)
      .catch((error) => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message.target === "background" && message.type === "CONFIGURE_RECORDER") {
    saveSettings(message.settings ?? {})
      .then((settings) => sendResponse({ok: true, projectId: settings.projectId, productName: settings.productName}))
      .catch((error) => sendResponse({ok: false, error: error.message}));
    return true;
  }
  if (message.target === "background" && message.type === "RECORDER_STATUS") {
    readSettings()
      .then(({settings, state, recording}) => sendResponse({
        ok: true,
        state,
        recording,
        configured: Boolean(settings?.apiUrl && settings?.projectId),
        projectId: settings?.projectId,
        productName: settings?.productName,
        targetUrl: settings?.targetUrl,
      }))
      .catch((error) => sendResponse({ok: false, error: error.message}));
    return true;
  }
});
