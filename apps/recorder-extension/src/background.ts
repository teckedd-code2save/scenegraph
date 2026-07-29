type CaptureSession = {tabId: number; startedAt: string; events: unknown[]};
let current: CaptureSession | null = null;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  if (current) {
    await chrome.tabs.sendMessage(current.tabId, {type: "SCENEGRAPH_STOP"});
    await chrome.storage.local.set({lastSceneGraphCapture: current});
    current = null;
    await chrome.action.setBadgeText({text: ""});
    return;
  }
  current = {tabId: tab.id, startedAt: new Date().toISOString(), events: []};
  await chrome.tabs.sendMessage(tab.id, {type: "SCENEGRAPH_START"});
  await chrome.action.setBadgeBackgroundColor({color: "#E14F3D"});
  await chrome.action.setBadgeText({text: "REC"});
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === "SCENEGRAPH_EVENT" && current && sender.tab?.id === current.tabId)
    current.events.push(message.event);
});
