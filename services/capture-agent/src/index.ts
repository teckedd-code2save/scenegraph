import path from "node:path";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {captureManifestSchema, type CaptureEvent} from "@scenegraph/contracts";

type Target = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
};

type Viewport = {
  width: number;
  height: number;
  deviceScaleFactor: number;
  url: string;
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

const env = (name: string, fallback?: string) => {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required`);
};

const directorUrl = env("SCENEGRAPH_DIRECTOR_URL", "http://localhost:4100").replace(/\/$/, "");
const chromeDebugUrl = env("CHROME_DEBUG_URL", "http://127.0.0.1:9222").replace(/\/$/, "");
const projectId = env("SCENEGRAPH_PROJECT_ID");
const targetUrl = process.env.SCENEGRAPH_TARGET_URL?.trim();
const accessToken = process.env.SCENEGRAPH_ACCESS_TOKEN?.trim();
const durationMs = Number(process.env.SCENEGRAPH_CAPTURE_MS ?? 45_000);
const frameEveryMs = Number(process.env.SCENEGRAPH_FRAME_MS ?? 500);
const outputRoot = path.resolve(process.env.SCENEGRAPH_CAPTURE_DIR ?? "./data/assisted-captures");

const headers = (extra: Record<string, string> = {}) => ({
  ...extra,
  ...(accessToken ? {authorization: `Bearer ${accessToken}`} : {}),
});

class Cdp {
  private id = 0;
  private pending = new Map<number, Pending>();
  private constructor(private socket: WebSocket) {}

  static connect(webSocketDebuggerUrl: string) {
    return new Promise<Cdp>((resolve, reject) => {
      const socket = new WebSocket(webSocketDebuggerUrl);
      socket.addEventListener("open", () => resolve(new Cdp(socket)), {once: true});
      socket.addEventListener("error", () => reject(new Error("Could not connect to Chrome DevTools")), {once: true});
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({id, method, params}));
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      if (this.pending.size === 1) this.listen();
    });
  }

  close() {
    this.socket.close();
  }

  private listen() {
    this.socket.addEventListener("message", (message) => {
      const payload = JSON.parse(String(message.data)) as {
        id?: number;
        result?: unknown;
        error?: {message?: string};
      };
      if (!payload.id) return;
      const pending = this.pending.get(payload.id);
      if (!pending) return;
      this.pending.delete(payload.id);
      if (payload.error) pending.reject(new Error(payload.error.message ?? "Chrome DevTools command failed"));
      else pending.resolve(payload.result);
    });
  }
}

const fetchJson = async <T>(url: string, init?: RequestInit) => {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return await response.json() as T;
};

const targetFor = async () => {
  const targets = await fetchJson<Target[]>(`${chromeDebugUrl}/json`).catch(() => {
    throw new Error(`Chrome DevTools is not available at ${chromeDebugUrl}. Start Chrome with --remote-debugging-port=9222, then open the authenticated product tab.`);
  });
  const pages = targets.filter((target) => target.type === "page" && target.webSocketDebuggerUrl);
  const existing = targetUrl
    ? pages.find((target) => target.url.includes(targetUrl) || target.title.toLowerCase().includes(targetUrl.toLowerCase()))
    : pages.find((target) => !target.url.startsWith("devtools://"));
  if (existing?.webSocketDebuggerUrl) return existing;
  if (!targetUrl) throw new Error("No attachable Chrome page found. Open the product tab or set SCENEGRAPH_TARGET_URL.");
  const created = await fetchJson<Target>(`${chromeDebugUrl}/json/new?${encodeURIComponent(targetUrl)}`, {method: "PUT"})
    .catch(() => fetchJson<Target>(`${chromeDebugUrl}/json/new?${encodeURIComponent(targetUrl)}`));
  if (!created.webSocketDebuggerUrl) throw new Error("Chrome created a tab without a debugger URL");
  return created;
};

const recorderScript = String.raw`
(() => {
  if (window.__scenegraphAssisted?.active) return true;
  const state = window.__scenegraphAssisted = {active: true, startedAt: performance.now(), events: []};
  const normalize = (value, limit = 120) => (value || "").replace(/\s+/g, " ").trim().slice(0, limit) || undefined;
  const selectorFor = (element) => {
    const testId = element.getAttribute("data-testid");
    if (testId) return '[data-testid="' + CSS.escape(testId) + '"]';
    if (element.id) return "#" + CSS.escape(element.id);
    const path = [];
    let node = element;
    while (node && node !== document.documentElement && path.length < 5) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const peers = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        if (peers.length > 1) part += ":nth-of-type(" + (peers.indexOf(node) + 1) + ")";
      }
      path.unshift(part);
      node = parent;
    }
    return path.join(" > ");
  };
  const elementText = (element) => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.type === "password") return undefined;
      return normalize(element.value || element.placeholder);
    }
    return normalize(element.textContent);
  };
  const labelFor = (element) => normalize(element.getAttribute("aria-label") || element.getAttribute("title") || element.getAttribute("data-testid")) || elementText(element);
  const visible = (element) => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 4 && rect.height > 4 && rect.bottom >= 0 && rect.right >= 0 && rect.top <= innerHeight && rect.left <= innerWidth && style.visibility !== "hidden" && style.display !== "none";
  };
  const metadata = (element) => {
    const rect = element.getBoundingClientRect();
    return {
      selector: selectorFor(element),
      rect: {x: rect.x, y: rect.y, width: rect.width, height: rect.height},
      tagName: element.tagName.toLowerCase(),
      role: normalize(element.getAttribute("role")),
      label: labelFor(element),
      text: elementText(element),
    };
  };
  const emit = (payload) => state.events.push({id: crypto.randomUUID(), atMs: performance.now() - state.startedAt, ...payload});
  const snapshot = () => {
    const candidates = Array.from(document.querySelectorAll("h1,h2,h3,button,a,input,textarea,select,[role],[aria-label],[data-testid]")).filter(visible).slice(0, 80);
    const visibleText = Array.from(document.querySelectorAll("h1,h2,h3,p,button,a,label")).filter(visible).map(elementText).filter(Boolean).slice(0, 80);
    emit({kind: "snapshot", url: location.href, title: document.title, visibleText, elements: candidates.map(metadata)});
  };
  document.addEventListener("click", (event) => {
    if (event.target instanceof Element) emit({kind: "click", button: event.button, ...metadata(event.target)});
  }, true);
  document.addEventListener("focusin", (event) => {
    if (event.target instanceof Element) emit({kind: "focus", ...metadata(event.target)});
  }, true);
  document.addEventListener("input", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;
    const masked = target instanceof HTMLInputElement && (target.type === "password" || target.autocomplete.includes("cc-") || target.autocomplete.includes("one-time-code"));
    emit({kind: "input", value: masked ? "********" : target.value, masked, ...metadata(target)});
  }, true);
  let scrollFrame = 0;
  document.addEventListener("scroll", () => {
    cancelAnimationFrame(scrollFrame);
    scrollFrame = requestAnimationFrame(() => emit({kind: "scroll", x: scrollX, y: scrollY}));
  }, {capture: true, passive: true});
  emit({kind: "navigation", url: location.href});
  snapshot();
  state.snapshotTimer = setInterval(snapshot, 1000);
  return true;
})()
`;

const viewportScript = "({width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio || 1, url: location.href})";
const eventsScript = "window.__scenegraphAssisted?.events || []";

const runFfmpeg = (framesDir: string, outputLocation: string, fps: number) => new Promise<void>((resolve, reject) => {
  const args = [
    "-y",
    "-framerate", String(fps),
    "-i", path.join(framesDir, "frame-%06d.jpg"),
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    outputLocation,
  ];
  const child = spawn("ffmpeg", args, {stdio: ["ignore", "ignore", "pipe"]});
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-1000) || `ffmpeg exited ${code}`)));
});

const uploadCapture = async (captureId: string, outputLocation: string, capture: Omit<ReturnType<typeof captureManifestSchema.parse>, "videoUrl">) => {
  const video = await readFile(outputLocation);
  const uploaded = await fetch(`${directorUrl}/v1/projects/${projectId}/captures/${captureId}/video`, {
    method: "PUT",
    headers: headers({"content-type": "video/mp4"}),
    body: video,
  });
  if (!uploaded.ok) throw new Error(`Video upload failed: ${uploaded.status} ${await uploaded.text()}`);
  const {videoUrl, assetKey} = await uploaded.json() as {videoUrl: string; assetKey?: string};
  const manifest = captureManifestSchema.parse({...capture, videoUrl, assetKey});
  const finalized = await fetch(`${directorUrl}/v1/projects/${projectId}/captures`, {
    method: "POST",
    headers: headers({"content-type": "application/json"}),
    body: JSON.stringify(manifest),
  });
  if (!finalized.ok) throw new Error(`Capture finalize failed: ${finalized.status} ${await finalized.text()}`);
  return manifest;
};

const main = async () => {
  const target = await targetFor();
  const cdp = await Cdp.connect(target.webSocketDebuggerUrl!);
  const captureId = randomUUID();
  const captureDir = path.join(outputRoot, captureId);
  const framesDir = path.join(captureDir, "frames");
  const outputLocation = path.join(captureDir, `${captureId}.mp4`);
  await mkdir(framesDir, {recursive: true});

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {source: recorderScript});
  await cdp.send("Runtime.evaluate", {expression: recorderScript, awaitPromise: true});
  const viewportResult = await cdp.send<{result: {value: Viewport}}>("Runtime.evaluate", {
    expression: viewportScript,
    returnByValue: true,
  });
  const viewport = viewportResult.result.value;
  const startedAt = new Date().toISOString();
  const frameCount = Math.max(1, Math.ceil(durationMs / frameEveryMs));

  for (let index = 0; index < frameCount; index += 1) {
    const screenshot = await cdp.send<{data: string}>("Page.captureScreenshot", {format: "jpeg", quality: 92, fromSurface: true});
    await writeFile(path.join(framesDir, `frame-${String(index + 1).padStart(6, "0")}.jpg`), Buffer.from(screenshot.data, "base64"));
    await new Promise((resolve) => setTimeout(resolve, frameEveryMs));
  }

  const eventsResult = await cdp.send<{result: {value: CaptureEvent[]}}>("Runtime.evaluate", {
    expression: eventsScript,
    returnByValue: true,
  });
  cdp.close();

  const fps = Math.round(1000 / frameEveryMs);
  await runFfmpeg(framesDir, outputLocation, fps);
  const rawEvents = eventsResult.result.value ?? [];
  const events = rawEvents.filter((event) => event && typeof event.kind === "string");
  const captureWithoutVideo = {
    id: captureId,
    projectId,
    sourceUrl: viewport.url,
    startedAt,
    durationMs,
    viewport: {
      width: Math.max(1, Math.round(viewport.width)),
      height: Math.max(1, Math.round(viewport.height)),
      deviceScaleFactor: viewport.deviceScaleFactor || 1,
    },
    events,
  };
  const manifest = await uploadCapture(captureId, outputLocation, captureWithoutVideo);
  await rm(framesDir, {recursive: true, force: true});
  console.log(JSON.stringify({
    ok: true,
    captureId: manifest.id,
    projectId: manifest.projectId,
    events: manifest.events.length,
    videoUrl: manifest.videoUrl,
  }, null, 2));
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
