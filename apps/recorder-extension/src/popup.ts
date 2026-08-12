const api = document.querySelector<HTMLInputElement>("#api")!;
const project = document.querySelector<HTMLInputElement>("#project")!;
const token = document.querySelector<HTMLInputElement>("#token")!;
const status = document.querySelector<HTMLDivElement>("#status")!;
const workspaceName = document.querySelector<HTMLElement>("#workspaceName")!;
const workspaceId = document.querySelector<HTMLElement>("#workspaceId")!;
const start = document.querySelector<HTMLButtonElement>("#start")!;
const stop = document.querySelector<HTMLButtonElement>("#stop")!;

const settings = () => ({apiUrl: api.value.trim(), projectId: project.value.trim(), accessToken: token.value.trim()});
const show = (message: string) => { status.textContent = message; };
const syncWorkspace = (saved?: {apiUrl?: string; projectId?: string; accessToken?: string; productName?: string}) => {
  if (!saved?.projectId) {
    workspaceName.textContent = "Not paired yet";
    workspaceId.textContent = "Open Studio and choose Connect extension.";
    start.disabled = true;
    return;
  }
  workspaceName.textContent = saved.productName || "Product workspace";
  workspaceId.textContent = saved.projectId;
  start.disabled = false;
};

chrome.storage.local.get(["scenegraphRecorderSettings", "scenegraphRecorderState"]).then((stored) => {
  const saved = stored.scenegraphRecorderSettings as {apiUrl?: string; projectId?: string; accessToken?: string; productName?: string} | undefined;
  if (saved?.apiUrl) api.value = saved.apiUrl;
  if (saved?.projectId) project.value = saved.projectId;
  if (saved?.accessToken) token.value = saved.accessToken;
  syncWorkspace(saved);
  if (stored.scenegraphRecorderState) show(labelForState(String(stored.scenegraphRecorderState)));
});

const labelForState = (state: string) => {
  if (state === "paired") return "Extension paired. Open the product tab and start recording.";
  if (state === "recording") return "Recording. Walk through the product, then stop.";
  if (state === "uploaded") return "Capture uploaded. Studio will pick it up.";
  if (state === "failed") return "Upload failed. Check the connection and try again.";
  return state;
};

start.addEventListener("click", async () => {
  const current = settings();
  if (!current.projectId) return show("Open Studio and choose Connect extension first.");
  if (!current.apiUrl) return show("Studio API is missing. Pair again from Studio.");
  show("Starting clean tab capture...");
  const result = await chrome.runtime.sendMessage({target: "background", type: "START_CAPTURE", settings: settings()});
  show(result.ok ? "Recording. Walk through the product, then stop." : result.error);
});

stop.addEventListener("click", async () => {
  show("Finalizing and uploading...");
  const result = await chrome.runtime.sendMessage({target: "background", type: "STOP_CAPTURE", settings: settings()});
  show(result.ok ? "Capture ready in the project workspace." : result.error);
});
