const api = document.querySelector<HTMLInputElement>("#api")!;
const project = document.querySelector<HTMLInputElement>("#project")!;
const token = document.querySelector<HTMLInputElement>("#token")!;
const status = document.querySelector<HTMLDivElement>("#status")!;

const settings = () => ({apiUrl: api.value.trim(), projectId: project.value.trim(), accessToken: token.value.trim()});
const show = (message: string) => { status.textContent = message; };

chrome.storage.local.get(["scenegraphRecorderSettings", "scenegraphRecorderState"]).then((stored) => {
  const saved = stored.scenegraphRecorderSettings as {apiUrl?: string; projectId?: string; accessToken?: string} | undefined;
  if (saved?.apiUrl) api.value = saved.apiUrl;
  if (saved?.projectId) project.value = saved.projectId;
  if (saved?.accessToken) token.value = saved.accessToken;
  if (stored.scenegraphRecorderState) show(String(stored.scenegraphRecorderState));
});

document.querySelector("#start")!.addEventListener("click", async () => {
  if (!settings().projectId) return show("Paste the project ID first.");
  show("Starting clean tab capture…");
  const result = await chrome.runtime.sendMessage({target: "background", type: "START_CAPTURE", settings: settings()});
  show(result.ok ? "Recording. Walk through the product, then stop." : result.error);
});

document.querySelector("#stop")!.addEventListener("click", async () => {
  show("Finalizing and uploading…");
  const result = await chrome.runtime.sendMessage({target: "background", type: "STOP_CAPTURE", settings: settings()});
  show(result.ok ? "Capture ready in the project workspace." : result.error);
});
