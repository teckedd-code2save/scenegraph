type RecorderSettings = {apiUrl: string; projectId: string};
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

const startCapture = async (settings: RecorderSettings) => {
  const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
  if (!tab.id || !tab.url) throw new Error("Select the product tab first");
  await ensureOffscreen();
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
});
