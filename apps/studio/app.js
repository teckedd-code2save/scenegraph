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
    `<article><small>${String(index + 1).padStart(2, "0")}</small><strong>${escape(scene.role)}</strong><span>${escape(scene.headline)}</span></article>`
  ).join("");
};

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const showProject = () => {
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

$("#generate").addEventListener("click", async () => {
  $("#generate").disabled = true;
  const response = await request(`/v1/projects/${project.id}/first-cut`, {method: "POST"});
  if (!response.ok) {
    const problem = await response.json();
    $("#notice").textContent = problem.error ?? "First cut could not be queued.";
    $("#generate").disabled = false;
    return;
  }
  const queued = await response.json();
  project.plans.push(queued.plan);
  render = {jobId: queued.jobId, state: "waiting"};
  timeline(queued.plan.scenes);
  $("#stageMessage").textContent = "Render waiting";
  $("#progress").hidden = false;
  $("#notice").textContent = "The directing plan is locked. Rendering the new composition now.";
  clearInterval(poll);
  poll = setInterval(checkRender, 1500);
});

async function checkRender() {
  const response = await request(`/v1/projects/${project.id}/renders/${render.jobId}`);
  if (!response.ok) return;
  render = await response.json();
  $("#stageMessage").textContent = `Render ${render.state}`;
  $("#renderError").textContent = render.error ?? "";
  if (render.downloadUrl) {
    clearInterval(poll);
    $("#stage").hidden = true; $("#player").hidden = false;
    $("#player video").src = render.downloadUrl;
    $("#player a").href = render.downloadUrl;
  }
  if (render.state === "failed") {clearInterval(poll); $("#progress").hidden = true;}
}

timeline();
