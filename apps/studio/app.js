const api = globalThis.SCENEGRAPH_API ?? "http://localhost:4100";
const roles = ["Hook", "Problem", "Product in action", "Outcome", "Proof", "Fit", "Close"];
let project = null;
let render = null;
let poll = null;
const $ = (selector) => document.querySelector(selector);
let accessToken = localStorage.getItem("scenegraphAccessToken") ?? "";
$("#accessToken").value = accessToken;

const request = (pathname, options = {}) => fetch(`${api}${pathname}`, {
  ...options,
  headers: {
    ...(options.headers ?? {}),
    ...(accessToken ? {authorization: `Bearer ${accessToken}`} : {}),
  },
});

const timeline = (scenes = roles.map((role) => ({role, headline: "Awaiting direction"}))) => {
  $("#timeline").innerHTML = scenes.map((scene, index) =>
    `<article><small>${String(index + 1).padStart(2, "0")}</small><strong>${escape(scene.role)}</strong><span>${escape(scene.headline)}</span><em>${escape(scene.rationale ?? "No scene rationale yet.")}</em></article>`
  ).join("");
};

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const resetPlayer = () => {
  const video = $("#renderVideo");
  $("#player").hidden = true;
  $("#downloadRender").hidden = true;
  $("#downloadRender").removeAttribute("href");
  $("#quality").textContent = "";
  video.pause();
  video.removeAttribute("src");
  video.load();
};

const waitForVideo = (video) => new Promise((resolve, reject) => {
  const cleanup = () => {
    video.removeEventListener("canplay", handleReady);
    video.removeEventListener("error", handleError);
  };
  const handleReady = () => {
    cleanup();
    resolve();
  };
  const handleError = () => {
    cleanup();
    reject(new Error("The video file could not be loaded."));
  };
  video.addEventListener("canplay", handleReady, {once: true});
  video.addEventListener("error", handleError, {once: true});
});

async function showPlayableRender() {
  const response = await fetch(render.downloadUrl, {method: "HEAD", cache: "no-store"}).catch(() => null);
  if (!response?.ok) {
    $("#progress").hidden = true;
    $("#stage").hidden = false;
    $("#player").hidden = true;
    $("#stageMessage").textContent = "Render completed";
    $("#renderError").textContent = "The video file is not available yet. Try Refresh capture or render again.";
    $("#master").disabled = false;
    $("#generate").disabled = false;
    return;
  }

  const video = $("#renderVideo");
  const download = $("#downloadRender");
  $("#stageMessage").textContent = "Preparing playback";
  $("#renderError").textContent = "";
  download.hidden = true;
  download.href = render.downloadUrl;
  $("#quality").textContent = render.profile === "master" ? "Master · 1080p · 60 fps" : "Preview · 720p · 30 fps";

  try {
    const ready = waitForVideo(video);
    video.src = render.downloadUrl;
    await ready;
  } catch (error) {
    $("#progress").hidden = true;
    $("#stage").hidden = false;
    $("#player").hidden = true;
    $("#stageMessage").textContent = "Render completed";
    $("#renderError").textContent = error.message;
    $("#master").disabled = false;
    $("#generate").disabled = false;
    return;
  }

  $("#progress").hidden = true;
  $("#stage").hidden = true;
  $("#player").hidden = false;
  download.hidden = false;
  $("#master").hidden = render.profile === "master";
  $("#master").disabled = false;
  $("#generate").disabled = false;
  $("#notice").textContent = `${render.profile === "master" ? "Master" : "Preview"} ready.`;
}

const showProject = () => {
  localStorage.setItem("scenegraphActiveProjectId", project.id);
  $("#create").hidden = true;
  $("#workspace").hidden = false;
  $("#projectLabel").hidden = false;
  $("#projectLabel").innerHTML = `${escape(project.brief.productName)}<span>Product workspace</span>`;
  $("#promise").textContent = project.brief.launchPromise;
  $("#projectId").textContent = project.id;
  const ready = project.captures.length > 0;
  $("#captureStatus").textContent = ready ? "Capture ready" : "Awaiting clean capture";
  $("#captureStatus").className = ready ? "status ready" : "status";
  $("#generate").disabled = !ready;
  timeline(project.plans.at(-1)?.scenes);
};

const loadProject = async (id, quiet = false) => {
  if (!id) return false;
  accessToken = $("#accessToken").value.trim();
  if (accessToken) localStorage.setItem("scenegraphAccessToken", accessToken);
  else localStorage.removeItem("scenegraphAccessToken");
  const response = await request(`/v1/projects/${id}`).catch(() => null);
  if (!response?.ok) {
    if (!quiet) $("#createNotice").textContent = "That workspace could not be opened. Check the project ID and API.";
    return false;
  }
  project = await response.json();
  showProject();
  $("#notice").textContent = "Workspace restored.";
  return true;
};

$("#restore").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  button.disabled = true; button.textContent = "Opening...";
  await loadProject($("#restoreId").value.trim());
  button.disabled = false; button.textContent = "Open workspace";
});

$("#brief").addEventListener("submit", async (event) => {
  event.preventDefault();
  accessToken = $("#accessToken").value.trim();
  if (accessToken) localStorage.setItem("scenegraphAccessToken", accessToken);
  else localStorage.removeItem("scenegraphAccessToken");
  const button = event.currentTarget.querySelector("button");
  button.disabled = true; button.textContent = "Creating…";
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const response = await request("/v1/projects", {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify({...values, tone: "precise", brand: {primary: values.primary, surface: "#F5F5F1", ink: "#111411"}}),
  }).catch(() => null);
  button.disabled = false; button.textContent = "Create product workspace →";
  if (!response?.ok) return $("#createNotice").textContent = "The workspace could not be created. Check the brief and API.";
  project = await response.json();
  showProject();
  $("#notice").textContent = "Workspace ready. Copy its ID into the recorder extension.";
});

$("#refresh").addEventListener("click", async () => {
  const response = await request(`/v1/projects/${project.id}`);
  if (response.ok) {project = await response.json(); showProject();}
});

async function requestRender(pathname, waitingMessage) {
  $("#generate").disabled = true;
  $("#master").disabled = true;
  resetPlayer();
  $("#stage").hidden = false;
  const response = await request(`/v1/projects/${project.id}/${pathname}`, {method: "POST"});
  if (!response.ok) {
    const problem = await response.json();
    $("#notice").textContent = problem.error ?? "First cut could not be queued.";
    $("#generate").disabled = false;
    $("#master").disabled = false;
    return;
  }
  const queued = await response.json();
  if (!project.plans.some((plan) => plan.id === queued.plan.id)) project.plans.push(queued.plan);
  render = {jobId: queued.jobId, state: "waiting"};
  timeline(queued.plan.scenes);
  $("#stageMessage").textContent = waitingMessage;
  $("#progress").hidden = false;
  $("#notice").textContent = "The directing plan is locked. Rendering the new composition now.";
  clearInterval(poll);
  poll = setInterval(checkRender, 1500);
}

$("#generate").addEventListener("click", () => requestRender("first-cut", "Preview waiting"));
$("#master").addEventListener("click", () => requestRender("master", "1080p master waiting"));

async function checkRender() {
  const response = await request(`/v1/projects/${project.id}/renders/${render.jobId}`);
  if (!response.ok) return;
  render = await response.json();
  $("#stageMessage").textContent = `Render ${render.state}`;
  $("#renderError").textContent = render.error ?? "";
  if (render.downloadUrl) {
    clearInterval(poll);
    await showPlayableRender();
  }
  if (render.state === "failed") {
    clearInterval(poll); $("#progress").hidden = true;
    $("#generate").disabled = false; $("#master").disabled = false;
  }
}

timeline();
void loadProject(localStorage.getItem("scenegraphActiveProjectId"), true);
