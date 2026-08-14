const api = globalThis.SCENEGRAPH_API ?? "http://localhost:4100";
const roles = ["Hook", "Problem", "Product in action", "Outcome", "Proof", "Fit", "Close"];
const directorTemplates = {
  launch: "Launch film",
  "product-demo": "Product demo",
  training: "Training walkthrough",
  support: "Support answer",
};
const directorTemplateDetails = {
  launch: {
    title: "Launch film",
    description: "A campaign cut that sells the change without hiding the product.",
    rhythm: "45s",
    treatment: "Fast proof arc",
    scenes: ["Hook", "Problem", "Action", "Proof", "Close"],
    visual: "Product-led, restrained captions, confident pacing.",
  },
  "product-demo": {
    title: "Product demo",
    description: "A walkthrough that stays inside the real workflow.",
    rhythm: "55s",
    treatment: "Guided workflow",
    scenes: ["Context", "Step", "Result", "Verify", "Recap"],
    visual: "Clear zooms, cursor path, feature-by-feature continuity.",
  },
  training: {
    title: "Training walkthrough",
    description: "An instructional cut for learning the exact process.",
    rhythm: "60s",
    treatment: "Teachable steps",
    scenes: ["Setup", "Step 1", "Step 2", "Check", "Done"],
    visual: "Slower holds, explicit step labels, verification emphasis.",
  },
  support: {
    title: "Support answer",
    description: "A problem-to-resolution answer for a visible issue.",
    rhythm: "50s",
    treatment: "Fix path",
    scenes: ["Symptom", "Cause", "Fix", "Confirm", "Share"],
    visual: "Diagnostic framing, fewer flourishes, outcome first.",
  },
};
let project = null;
let render = null;
let poll = null;
let capturePoll = null;
let workspaces = [];
const $ = (selector) => document.querySelector(selector);
const submitButton = (form) => form.querySelector('button[type="submit"], button:not([type])');
let accessToken = localStorage.getItem("scenegraphAccessToken") ?? "";
$("#accessToken").value = accessToken;

const request = (pathname, options = {}) => fetch(`${api}${pathname}`, {
  ...options,
  headers: {
    ...(options.headers ?? {}),
    ...(accessToken ? {authorization: `Bearer ${accessToken}`} : {}),
  },
});

const syncAccessToken = () => {
  accessToken = $("#accessToken").value.trim();
  if (accessToken) localStorage.setItem("scenegraphAccessToken", accessToken);
  else localStorage.removeItem("scenegraphAccessToken");
};

const timeline = (scenes = roles.map((role) => ({role, headline: "Awaiting direction"}))) => {
  $("#timeline").innerHTML = scenes.map((scene, index) =>
    `<article>
      <small>${String(index + 1).padStart(2, "0")}</small>
      <strong>${escape(scene.role)}</strong>
      <span>${escape(scene.headline)}</span>
      <em>${escape(scene.rationale ?? "No scene rationale yet.")}</em>
      ${scene.evidence?.observation ? `<mark>${escape(scene.evidence.observation)}</mark>` : ""}
    </article>`
  ).join("");
};

const renderTemplateDeck = (selected = "launch") => {
  $("#templateDeck").innerHTML = Object.entries(directorTemplateDetails).map(([value, template]) => `
    <button class="templateCard ${value === selected ? "selected" : ""}" type="button" data-template="${escape(value)}">
      <span class="templateCopy">
        <strong>${escape(template.title)}</strong>
        <em>${escape(template.description)}</em>
      </span>
      <span class="templatePreview" aria-hidden="true">
        ${template.scenes.map((scene, index) => `<i style="--step:${index + 1}"></i>`).join("")}
      </span>
      <span class="templateSequence">${template.scenes.map((scene) => `<i>${escape(scene)}</i>`).join("")}</span>
      <span class="templateMeta">
        <small>${escape(template.rhythm)}</small>
        <small>${escape(template.treatment)}</small>
      </span>
      <span class="templateUse">${escape(templateReason(value))}</span>
    </button>
  `).join("");
};

const templateReason = (value) => ({
  launch: "Best when the goal is a launch or sales-ready product film.",
  "product-demo": "Best when the brief is about showing a real workflow end to end.",
  training: "Best when the viewer should learn repeatable steps.",
  support: "Best when the video starts from a problem, incident, or fix.",
})[value] ?? "A good default for the product story.";

const recommendedTemplateFor = (description) => {
  const text = String(description).toLowerCase();
  if (/\b(fix|issue|bug|error|failed|failure|support|resolve|incident|troubleshoot)\b/.test(text)) return "support";
  if (/\b(train|training|learn|tutorial|how to|onboard|guide|step)\b/.test(text)) return "training";
  if (/\b(demo|walkthrough|workflow|feature|show how|product tour)\b/.test(text)) return "product-demo";
  return "launch";
};

const renderCreateTemplateDeck = (selected = "launch", recommended = selected) => {
  $("#createTemplateDeck").innerHTML = Object.entries(directorTemplateDetails).map(([value, template]) => `
    <button class="templateCard ${value === selected ? "selected" : ""} ${value === recommended ? "recommended" : ""}" type="button" data-template="${escape(value)}">
      <span class="templateCopy">
        <strong>${escape(template.title)}</strong>
        <em>${escape(template.description)}</em>
      </span>
      <span class="templatePreview" aria-hidden="true">
        ${template.scenes.map((scene, index) => `<i style="--step:${index + 1}"></i>`).join("")}
      </span>
      <span class="templateSequence">${template.scenes.map((scene) => `<i>${escape(scene)}</i>`).join("")}</span>
      <span class="templateMeta">
        <small>${escape(template.rhythm)}</small>
        <small>${escape(template.treatment)}</small>
        ${value === recommended ? "<small>Recommended</small>" : ""}
      </span>
      <span class="templateUse">${escape(templateReason(value))}</span>
    </button>
  `).join("");
};

const setCreateStep = (step) => {
  const choosingTemplate = step === "template";
  $("#briefStep").hidden = choosingTemplate;
  $("#templateStep").hidden = !choosingTemplate;
  $("#createSubmit").textContent = choosingTemplate ? "Create workspace →" : "Review templates →";
  $("#createDialog").dataset.step = step;
};

const summarizeCaptureEvidence = () => {
  const capture = project?.captures?.at(-1);
  if (!capture) {
    $("#evidenceSummary").textContent = "No capture evidence yet";
    return;
  }
  const snapshots = capture.events.filter((event) => event.kind === "snapshot").length;
  const interactions = capture.events.filter((event) => ["click", "focus", "input"].includes(event.kind)).length;
  const seconds = Math.max(1, Math.round(capture.durationMs / 1000));
  $("#evidenceSummary").textContent = `${seconds}s capture · ${snapshots} states · ${interactions} interactions`;
};

const renderWorkspaceList = () => {
  $("#workspaceCount").textContent = `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}`;
  $("#workspaceList").innerHTML = workspaces.length ? workspaces.map((item) => `
    <button class="workspaceItem" type="button" data-project-id="${escape(item.id)}">
      <span>
        <strong>${escape(item.productName)}</strong>
        <em>${escape(item.launchPromise)}</em>
      </span>
      <small>${escape(directorTemplates[item.directorTemplate ?? "launch"] ?? "Launch film")} · ${item.captures} capture${item.captures === 1 ? "" : "s"} · ${item.renders} render${item.renders === 1 ? "" : "s"}</small>
    </button>
  `).join("") : `<div class="emptyState"><strong>No workspaces yet.</strong><span>Create one to start capturing product evidence.</span></div>`;
};

const loadWorkspaces = async () => {
  syncAccessToken();
  const response = await request("/v1/projects").catch(() => null);
  if (!response?.ok) {
    $("#workspaceCount").textContent = "Unavailable";
    $("#workspaceList").innerHTML = `<div class="emptyState"><strong>Could not load workspaces.</strong><span>Check the Director API and access token.</span></div>`;
    return;
  }
  workspaces = await response.json();
  renderWorkspaceList();
};

const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);

const defaultJourney = (brief) => ({
  goal: `Show how ${brief.productName} turns a specific product problem into a verified outcome.`,
  startState: brief.customerProblem,
  keyBeats: ["Inspect the starting state", "Take the decisive product action", "Verify the result"],
  successState: brief.launchPromise,
  avoid: "Do not use generic scenes unless they match captured product evidence.",
});

const sentence = (value, fallback) => {
  const normalized = String(value ?? "").trim().replace(/\s+/g, " ");
  if (!normalized) return fallback;
  return normalized.match(/[^.!?]+[.!?]?/)?.[0]?.trim() || fallback;
};

const productNameFromUrl = (productUrl) => {
  try {
    const host = new URL(productUrl).hostname.replace(/^www\./, "");
    const label = host.split(".")[0] || "Product";
    return label.split(/[-_]/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join(" ");
  } catch {
    return "Product";
  }
};

const audienceFromDescription = (description) => {
  const match = String(description).match(/\bfor\s+([^,.]+(?:teams|founders|operators|users|companies|customers|developers|engineers|admins|creators)?)/i);
  return match?.[1]?.trim() || "Product teams";
};

const briefFromSimpleForm = (values) => {
  const description = String(values.description).trim();
  const productName = String(values.productName).trim() || productNameFromUrl(values.productUrl);
  const firstSentence = sentence(description, `${productName} turns product work into a visible outcome.`);
  return {
    productName,
    productUrl: values.productUrl,
    customerProblem: description.length >= 12 ? description : `${productName} needs a clear product story.`,
    audience: audienceFromDescription(description),
    launchPromise: firstSentence.length >= 8 ? firstSentence.slice(0, 160) : `${productName} makes the product outcome visible.`,
    directorTemplate: values.directorTemplate,
    tone: "precise",
    brand: {primary: "#0f8fdb", surface: "#F6F7F4", ink: "#151815"},
  };
};

const journeyFromForm = (form) => {
  const values = Object.fromEntries(new FormData(form));
  return {
    goal: values.goal,
    startState: values.startState,
    keyBeats: String(values.keyBeats).split(/\n+/).map((beat) => beat.trim()).filter(Boolean),
    successState: values.successState,
    avoid: values.avoid || undefined,
  };
};

const setJourneyForm = () => {
  const journey = project.brief.journey ?? defaultJourney(project.brief);
  const form = $("#journey");
  form.elements.goal.value = journey.goal;
  form.elements.startState.value = journey.startState;
  form.elements.keyBeats.value = journey.keyBeats.join("\n");
  form.elements.successState.value = journey.successState;
  form.elements.avoid.value = journey.avoid ?? "";
  form.elements.directorTemplate.value = project.brief.directorTemplate ?? "launch";
  renderTemplateDeck(form.elements.directorTemplate.value);
};

const ensureDirection = async () => {
  if (project.brief.journey) return true;
  const journey = defaultJourney(project.brief);
  const response = await request(`/v1/projects/${project.id}/brief`, {
    method: "PUT",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({...project.brief, journey}),
  }).catch(() => null);
  if (!response?.ok) {
    $("#notice").textContent = "Direction could not be saved. Open Direction, save it, then generate again.";
    return false;
  }
  project = await response.json();
  showProject();
  return true;
};

const extensionSettings = () => ({
  apiUrl: api,
  accessToken,
  projectId: project.id,
  productName: project.brief.productName,
  targetUrl: project.brief.productUrl,
  studioUrl: location.href,
});

const requestExtensionStatus = () => {
  window.postMessage({type: "SCENEGRAPH_EXTENSION_STATUS"}, location.origin);
};

const pairExtension = () => {
  if (!project) return;
  accessToken = $("#accessToken").value.trim();
  if (accessToken) localStorage.setItem("scenegraphAccessToken", accessToken);
  else localStorage.removeItem("scenegraphAccessToken");
  $("#extensionStatus").textContent = "Waiting for the extension to confirm this workspace...";
  window.postMessage({type: "SCENEGRAPH_CONFIGURE_EXTENSION", settings: extensionSettings()}, location.origin);
  setTimeout(() => {
    if ($("#extensionStatus").textContent.includes("Waiting")) {
      $("#extensionStatus").textContent = "No extension response yet. Reload SceneGraph Capture from chrome://extensions, then choose Connect extension again.";
    }
  }, 1800);
};

const resetPlayer = () => {
  const video = $("#renderVideo");
  $("#player").hidden = true;
  $("#downloadRender").hidden = true;
  $("#guidance").hidden = true;
  $("#guidanceList").innerHTML = "";
  $("#downloadRender").removeAttribute("href");
  $("#quality").textContent = "";
  video.pause();
  video.removeAttribute("src");
  video.load();
};

const friendlyMissingLabel = (label) => {
  const value = String(label).replace(/^(start state|beat|success state):\s*/i, "").trim();
  if (/story progression/i.test(value)) return "Capture separate moments for the beginning, action, and result.";
  if (/story order/i.test(value)) return "Record the walkthrough in the same order the story should unfold.";
  return `Show: ${value}`;
};

const showGuidance = (problem) => {
  const missing = problem.details?.missing ?? [];
  $("#stage").hidden = false;
  $("#progress").hidden = true;
  $("#stageMessage").textContent = "More capture needed";
  $("#renderError").textContent = "";
  $("#guidance").hidden = false;
  $("#guidanceList").innerHTML = (missing.length ? missing : [
    {label: "the starting problem"},
    {label: "the action that changes the product"},
    {label: "the final proof screen"},
  ]).map((item) => `<li>${escape(friendlyMissingLabel(item.label))}</li>`).join("");
  $("#notice").textContent = "Record those moments or update the direction, then generate the preview again.";
};

const waitForVideo = (video) => new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    cleanup();
    reject(new Error("The MP4 is ready, but the browser has not reported playback metadata yet."));
  }, 45_000);
  const cleanup = () => {
    clearTimeout(timeout);
    video.removeEventListener("loadedmetadata", handleReady);
    video.removeEventListener("error", handleError);
  };
  const handleReady = () => {
    if (!Number.isFinite(video.duration) || video.duration <= 0) {
      cleanup();
      reject(new Error("The render finished, but the video has no playable duration."));
      return;
    }
    cleanup();
    resolve();
  };
  const handleError = () => {
    cleanup();
    reject(new Error("The video file could not be loaded."));
  };
  video.addEventListener("loadedmetadata", handleReady, {once: true});
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
  const playableUrl = `${render.downloadUrl}${render.downloadUrl.includes("?") ? "&" : "?"}ready=${Date.now()}`;
  $("#stageMessage").textContent = "Preparing playback";
  $("#renderError").textContent = "";
  download.href = playableUrl;
  $("#quality").textContent = render.profile === "master" ? "Master · 1080p · 60 fps" : "Preview · 720p · 30 fps";
  $("#player").hidden = false;
  download.hidden = false;
  video.preload = "metadata";

  try {
    const ready = waitForVideo(video);
    video.src = playableUrl;
    video.load();
    await ready;
  } catch (error) {
    $("#progress").hidden = true;
    $("#stage").hidden = false;
    $("#stageMessage").textContent = "Render completed";
    $("#renderError").textContent = `${error.message} You can still use the player controls or download the MP4.`;
    $("#master").disabled = false;
    $("#generate").disabled = false;
    return;
  }

  $("#progress").hidden = true;
  $("#stage").hidden = true;
  $("#master").hidden = render.profile === "master";
  $("#master").disabled = false;
  $("#generate").disabled = false;
  $("#notice").textContent = `${render.profile === "master" ? "Master" : "Preview"} ready.`;
}

const showProject = () => {
  clearInterval(capturePoll);
  localStorage.setItem("scenegraphActiveProjectId", project.id);
  $("#home").hidden = true;
  $("#workspace").hidden = false;
  $("#projectLabel").hidden = false;
  $("#projectLabel").innerHTML = `${escape(project.brief.productName)}<span>Product workspace</span>`;
  $("#promise").textContent = project.brief.launchPromise;
  $("#projectId").textContent = project.id;
  const ready = project.captures.length > 0;
  $("#captureStatus").textContent = ready ? "Capture ready" : "Awaiting clean capture";
  $("#captureStatus").className = ready ? "status ready" : "status";
  $("#captureCopy").textContent = ready
    ? "Capture evidence is available. Record another pass any time the story needs stronger product proof."
    : "Connect the extension to this workspace, open the product tab, then let SceneGraph collect the journey evidence.";
  $("#extensionStatus").textContent = "Pair the extension so it knows this workspace, the Studio API, and the product URL.";
  $("#generate").disabled = !ready;
  setJourneyForm();
  timeline(project.plans.at(-1)?.scenes);
  $("#planState").textContent = project.plans.length ? "Latest plan ready" : "No generated plan yet";
  summarizeCaptureEvidence();
  requestExtensionStatus();
  if (!ready) capturePoll = setInterval(checkCapture, 2500);
};

const restoreLatestRender = async () => {
  if (!project?.renders?.length) {
    resetPlayer();
    return;
  }
  const latest = [...project.renders].reverse().find((item) => item.downloadUrl && item.state === "completed");
  if (!latest) {
    resetPlayer();
    return;
  }
  render = latest;
  $("#stageMessage").textContent = "Restoring latest render";
  $("#stage").hidden = false;
  await showPlayableRender();
};

const showHome = async () => {
  clearInterval(poll);
  clearInterval(capturePoll);
  localStorage.removeItem("scenegraphActiveProjectId");
  project = null;
  render = null;
  $("#workspace").hidden = true;
  $("#home").hidden = false;
  $("#projectLabel").hidden = true;
  $("#projectLabel").textContent = "";
  $("#restoreId").value = "";
  $("#createNotice").textContent = "";
  resetPlayer();
  timeline();
  await loadWorkspaces();
};

const loadProject = async (id, quiet = false) => {
  if (!id) return false;
  syncAccessToken();
  const response = await request(`/v1/projects/${id}`).catch(() => null);
  if (!response?.ok) {
    if (!quiet) $("#createNotice").textContent = "That workspace could not be opened. Check the project ID and API.";
    return false;
  }
  project = await response.json();
  showProject();
  await restoreLatestRender();
  $("#notice").textContent = "Workspace restored.";
  return true;
};

$("#restore").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = submitButton(event.currentTarget);
  button.disabled = true; button.textContent = "Opening...";
  await loadProject($("#restoreId").value.trim());
  button.disabled = false; button.textContent = "Open workspace";
});

$("#brief").addEventListener("submit", async (event) => {
  event.preventDefault();
  syncAccessToken();
  const button = submitButton(event.currentTarget);
  const values = Object.fromEntries(new FormData(event.currentTarget));
  if ($("#createDialog").dataset.step !== "template") {
    const recommended = recommendedTemplateFor(values.description);
    event.currentTarget.elements.directorTemplate.value = recommended;
    $("#templateRecommendation").textContent = `${directorTemplateDetails[recommended].title} is recommended. ${templateReason(recommended)}`;
    renderCreateTemplateDeck(recommended, recommended);
    setCreateStep("template");
    return;
  }
  button.disabled = true; button.textContent = "Creating...";
  const response = await request("/v1/projects", {
    method: "POST", headers: {"content-type": "application/json"},
    body: JSON.stringify(briefFromSimpleForm(values)),
  }).catch(() => null);
  button.disabled = false; button.textContent = "Create workspace →";
  if (!response?.ok) return $("#createNotice").textContent = "The workspace could not be created. Check the brief and API.";
  project = await response.json();
  $("#createDialog").close();
  await loadWorkspaces();
  showProject();
  $("#notice").textContent = "Workspace ready. Connect the browser extension, then record the product tab.";
});

const refreshProject = async () => {
  const response = await request(`/v1/projects/${project.id}`);
  if (response.ok) {project = await response.json(); showProject(); await restoreLatestRender();}
};

async function checkCapture() {
  if (!project) return;
  const previousCount = project.captures.length;
  const response = await request(`/v1/projects/${project.id}`).catch(() => null);
  if (!response?.ok) return;
  const latest = await response.json();
  if (latest.captures.length <= previousCount) return;
  project = latest;
  showProject();
  await restoreLatestRender();
  $("#notice").textContent = "Capture uploaded. SceneGraph has fresh product evidence.";
}

$("#homeButton").addEventListener("click", showHome);
$("#backToWorkspaces").addEventListener("click", showHome);
$("#openCreate").addEventListener("click", () => {
  setCreateStep("brief");
  $("#brief").reset();
  $("#createDialog").showModal();
});
$("#closeCreate").addEventListener("click", () => $("#createDialog").close());
$("#backToBrief").addEventListener("click", () => setCreateStep("brief"));
$("#pairExtension").addEventListener("click", pairExtension);
$("#openProduct").addEventListener("click", () => {
  if (!project?.brief.productUrl) return;
  window.open(project.brief.productUrl, "_blank", "noopener");
});
$("#newCapture").addEventListener("click", () => {
  pairExtension();
  if (project?.brief.productUrl) window.open(project.brief.productUrl, "_blank", "noopener");
});
$("#workspaceList").addEventListener("click", async (event) => {
  if (!(event.target instanceof Element)) return;
  const item = event.target.closest("[data-project-id]");
  if (item) await loadProject(item.dataset.projectId);
});

$("#templateDeck").addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const item = event.target.closest("[data-template]");
  if (!item) return;
  $("#journey").elements.directorTemplate.value = item.dataset.template;
  renderTemplateDeck(item.dataset.template);
});

$("#createTemplateDeck").addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;
  const item = event.target.closest("[data-template]");
  if (!item) return;
  $("#brief").elements.directorTemplate.value = item.dataset.template;
  renderCreateTemplateDeck(item.dataset.template, recommendedTemplateFor($("#brief").elements.description.value));
});

$("#journey").elements.directorTemplate.addEventListener("change", (event) => {
  renderTemplateDeck(event.target.value);
});

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.type !== "SCENEGRAPH_EXTENSION_RESPONSE") return;
  if (!project) return;
  if (!event.data.ok) {
    $("#extensionStatus").textContent = event.data.error || "The extension could not be reached. Reload it from chrome://extensions.";
    return;
  }
  if (event.data.configured && event.data.projectId === project.id) {
    $("#extensionStatus").textContent = event.data.recording
      ? "Extension is recording this workspace. Stop from the SceneGraph bar on the product page when complete."
      : "Extension connected. Open the product tab, click SceneGraph Capture once, then use the in-page SceneGraph bar.";
    return;
  }
  if (event.data.projectId === project.id) {
    $("#extensionStatus").textContent = "Extension connected. Open the product tab, click SceneGraph Capture once, then use the in-page SceneGraph bar.";
    return;
  }
  if (event.data.projectId) {
    $("#extensionStatus").textContent = "Extension is paired elsewhere. Connect to switch it here.";
  }
});

$("#journey").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector('button[form="journey"]') ?? submitButton(event.currentTarget);
  button.disabled = true; button.textContent = "Saving...";
  const response = await request(`/v1/projects/${project.id}/brief`, {
    method: "PUT",
    headers: {"content-type": "application/json"},
    body: JSON.stringify({
      ...project.brief,
      directorTemplate: Object.fromEntries(new FormData(event.currentTarget)).directorTemplate,
      journey: journeyFromForm(event.currentTarget),
    }),
  }).catch(() => null);
  button.disabled = false; button.textContent = "Save";
  if (!response?.ok) {
    $("#notice").textContent = "Direction could not be saved.";
    return;
  }
  project = await response.json();
  showProject();
  $("#notice").textContent = "Direction saved. The next preview will follow this journey.";
});

async function requestRender(pathname, waitingMessage) {
  if (!await ensureDirection()) return;
  $("#generate").disabled = true;
  $("#master").disabled = true;
  resetPlayer();
  $("#stage").hidden = false;
  const response = await request(`/v1/projects/${project.id}/${pathname}`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!response) {
    $("#stageMessage").textContent = "Preview could not start";
    $("#renderError").textContent = "The render queue did not respond. Check Redis and the render worker, then try again.";
    $("#generate").disabled = false;
    $("#master").disabled = false;
    return;
  }
  if (!response.ok) {
    const problem = await response.json().catch(() => ({error: "Preview could not start"}));
    showGuidance(problem);
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
    const response = await request(`/v1/projects/${project.id}`).catch(() => null);
    if (response?.ok) project = await response.json();
  }
  if (render.state === "failed") {
    clearInterval(poll); $("#progress").hidden = true;
    $("#generate").disabled = false; $("#master").disabled = false;
  }
}

timeline();
const activeProjectId = localStorage.getItem("scenegraphActiveProjectId");
if (activeProjectId) void loadProject(activeProjectId, true).then((opened) => { if (!opened) void showHome(); });
else void showHome();
