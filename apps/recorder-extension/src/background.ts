type RecorderSettings = {apiUrl: string; projectId: string; accessToken: string; targetUrl?: string; productName?: string};
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
  await chrome.storage.local.set({scenegraphRecorderSettings: settings, scenegraphRecorderState: "recording"});
};

const stopCapture = async (settings: RecorderSettings) => {
  if (!current) throw new Error("No recording is active");
  await chrome.tabs.sendMessage(current.tabId, {type: "SCENEGRAPH_STOP"}).catch(() => undefined);
  await chrome.action.setBadgeText({text: "UP"});
  const result = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "STOP_RECORDING",
    apiUrl: settings.apiUrl.replace(/\/$/, ""),
    projectId: settings.projectId,
    accessToken: settings.accessToken,
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
  if (!result.ok) throw new Error(result.error);
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
