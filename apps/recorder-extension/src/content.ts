const state = {active: false, startedAt: 0};
let snapshotTimer = 0;
const bridgeMessages = new Set(["SCENEGRAPH_CONFIGURE_EXTENSION", "SCENEGRAPH_EXTENSION_STATUS"]);
const isStudioBridgePage = () =>
  Boolean(document.querySelector('meta[name="scenegraph-studio"][content="capture-bridge"]'));

const selectorFor = (element: Element): string => {
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;
  if (element.id) return `#${CSS.escape(element.id)}`;
  const path: string[] = [];
  let node: Element | null = element;
  while (node && node !== document.documentElement && path.length < 5) {
    let part = node.tagName.toLowerCase();
    const parent: Element | null = node.parentElement;
    if (parent) {
      const peers = Array.from(parent.children).filter((child) => child.tagName === node?.tagName);
      if (peers.length > 1) part += `:nth-of-type(${peers.indexOf(node) + 1})`;
    }
    path.unshift(part);
    node = parent;
  }
  return path.join(" > ");
};

const normalize = (value: string | null | undefined, limit = 96) =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, limit) || undefined;

const elementText = (element: Element) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    if (element.type === "password") return undefined;
    return normalize(element.value || element.placeholder);
  }
  return normalize(element.textContent);
};

const elementLabel = (element: Element) =>
  normalize(element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("data-testid")) ||
  elementText(element);

const isVisible = (element: Element) => {
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 4 && rect.height > 4 && rect.bottom >= 0 && rect.right >= 0 &&
    rect.top <= innerHeight && rect.left <= innerWidth && style.visibility !== "hidden" && style.display !== "none";
};

const metadata = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return {
    selector: selectorFor(element),
    rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
    tagName: element.tagName.toLowerCase(),
    role: normalize(element.getAttribute("role")),
    label: elementLabel(element),
    text: elementText(element),
  };
};

const emit = (payload: Record<string, unknown>) => {
  if (!state.active) return;
  chrome.runtime.sendMessage({
    type: "SCENEGRAPH_EVENT",
    event: {id: crypto.randomUUID(), atMs: performance.now() - state.startedAt, ...payload},
  });
};

const snapshot = () => {
  if (!state.active) return;
  const candidates = Array.from(document.querySelectorAll(
    "h1,h2,h3,button,a,input,textarea,select,[role],[aria-label],[data-testid]",
  )).filter(isVisible).slice(0, 60);
  const visibleText = Array.from(document.querySelectorAll("h1,h2,h3,p,button,a,label"))
    .filter(isVisible)
    .map((element) => elementText(element))
    .filter((value): value is string => Boolean(value))
    .slice(0, 60);
  emit({
    kind: "snapshot",
    url: location.href,
    title: document.title,
    visibleText,
    elements: candidates.map(metadata),
  });
};

const scheduleSnapshot = () => {
  clearTimeout(snapshotTimer);
  snapshotTimer = window.setTimeout(snapshot, 450);
};

document.addEventListener("click", (event) => {
  if (event.target instanceof Element) {
    emit({kind: "click", button: event.button, ...metadata(event.target)});
    scheduleSnapshot();
  }
}, true);

document.addEventListener("focusin", (event) => {
  if (event.target instanceof Element) {
    emit({kind: "focus", ...metadata(event.target)});
    scheduleSnapshot();
  }
}, true);

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  const masked = target instanceof HTMLInputElement &&
    (target.type === "password" || target.autocomplete.includes("cc-") ||
     target.autocomplete.includes("one-time-code") || target.dataset.scenegraphPrivate === "true");
  emit({kind: "input", value: masked ? "••••••••" : target.value, masked, ...metadata(target)});
  scheduleSnapshot();
}, true);

let scrollFrame = 0;
document.addEventListener("scroll", () => {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => emit({kind: "scroll", x: scrollX, y: scrollY}));
}, {capture: true, passive: true});

const originalPushState = history.pushState;
const originalReplaceState = history.replaceState;
const routeChanged = () => {
  if (!state.active) return;
  emit({kind: "navigation", url: location.href});
  scheduleSnapshot();
};
history.pushState = function pushState(...args) {
  originalPushState.apply(this, args);
  routeChanged();
};
history.replaceState = function replaceState(...args) {
  originalReplaceState.apply(this, args);
  routeChanged();
};
window.addEventListener("popstate", routeChanged);

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || typeof event.data !== "object") return;
  if (!bridgeMessages.has(event.data.type)) return;
  if (!isStudioBridgePage()) return;

  const reply = (payload: Record<string, unknown>) => {
    window.postMessage({type: "SCENEGRAPH_EXTENSION_RESPONSE", ...payload}, event.origin || "*");
  };

  if (event.data.type === "SCENEGRAPH_CONFIGURE_EXTENSION") {
    chrome.runtime.sendMessage({
      target: "background",
      type: "CONFIGURE_RECORDER",
      settings: event.data.settings,
    }).then((response) => reply(response)).catch((error) => reply({ok: false, error: error.message}));
    return;
  }

  chrome.runtime.sendMessage({target: "background", type: "RECORDER_STATUS"})
    .then((response) => reply(response))
    .catch((error) => reply({ok: false, error: error.message}));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "SCENEGRAPH_PING") {
    sendResponse({ok: true});
    return;
  }
  if (message.type === "SCENEGRAPH_START") {
    state.active = true;
    state.startedAt = performance.now();
    emit({kind: "navigation", url: location.href});
    snapshot();
  } else if (message.type === "SCENEGRAPH_STOP") state.active = false;
});
