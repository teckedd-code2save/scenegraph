const state = {active: false, startedAt: 0};

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

const metadata = (element: Element) => {
  const rect = element.getBoundingClientRect();
  return {
    selector: selectorFor(element),
    rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
  };
};

const emit = (payload: Record<string, unknown>) => {
  if (!state.active) return;
  chrome.runtime.sendMessage({
    type: "SCENEGRAPH_EVENT",
    event: {id: crypto.randomUUID(), atMs: performance.now() - state.startedAt, ...payload},
  });
};

document.addEventListener("click", (event) => {
  if (event.target instanceof Element)
    emit({kind: "click", button: event.button, ...metadata(event.target)});
}, true);

document.addEventListener("focusin", (event) => {
  if (event.target instanceof Element) emit({kind: "focus", ...metadata(event.target)});
}, true);

document.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
  const masked = target instanceof HTMLInputElement &&
    (target.type === "password" || target.autocomplete.includes("cc-") ||
     target.autocomplete.includes("one-time-code") || target.dataset.scenegraphPrivate === "true");
  emit({kind: "input", value: masked ? "••••••••" : target.value, masked, ...metadata(target)});
}, true);

let scrollFrame = 0;
document.addEventListener("scroll", () => {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => emit({kind: "scroll", x: scrollX, y: scrollY}));
}, {capture: true, passive: true});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "SCENEGRAPH_START") {
    state.active = true;
    state.startedAt = performance.now();
    emit({kind: "navigation", url: location.href});
  } else if (message.type === "SCENEGRAPH_STOP") state.active = false;
});
