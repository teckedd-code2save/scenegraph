import path from "node:path";
import {createHmac, timingSafeEqual} from "node:crypto";
import {createWriteStream} from "node:fs";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import type {Readable} from "node:stream";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import {Queue, Worker} from "bullmq";
import {
  captureManifestSchema,
  productBriefSchema,
  scenePlanSchema,
  renderJobSchema,
  renderResultSchema,
  type CaptureEvent,
  type CaptureManifest,
  type ProductBrief,
  type ScenePlan,
} from "@scenegraph/contracts";
import {createObjectStoreFromEnv} from "@scenegraph/media-store";

const camera = (scale = 1, x = 0, y = 0) => ({
  from: {x: 0, y: 0, scale: 1},
  to: {x, y, scale},
  easing: "standard" as const,
});

const cleanSegment = (value: string) =>
  value.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

const journeyName = (brief: ProductBrief, capture: CaptureManifest) => {
  try {
    const url = new URL(capture.sourceUrl || brief.productUrl);
    const segment = url.pathname.split("/").filter(Boolean).at(-1);
    return segment ? cleanSegment(segment) : brief.productName;
  } catch {
    return brief.productName;
  }
};

type Rect = {x: number; y: number; width: number; height: number};
type EvidenceEvent = CaptureEvent & {
  rect?: Rect;
  tagName?: string;
  role?: string;
  label?: string;
  text?: string;
};
type SnapshotEvent = EvidenceEvent & {
  kind: "snapshot";
  title?: string;
  visibleText: string[];
  elements: Array<{
    selector: string;
    rect: Rect;
    tagName: string;
    role?: string;
    label?: string;
    text?: string;
  }>;
};

const isInteractionEvent = (event: CaptureEvent): event is EvidenceEvent & {rect: Rect} =>
  ["click", "focus", "input"].includes(String(event.kind)) && Boolean(event.rect);

const isSnapshotEvent = (event: CaptureEvent): event is SnapshotEvent =>
  String(event.kind) === "snapshot";

const eventRect = (event: EvidenceEvent) =>
  event.rect ?? (isSnapshotEvent(event) ? event.elements[0]?.rect : undefined);

const eventLabel = (event: EvidenceEvent) => {
  if (isSnapshotEvent(event)) return event.title || event.visibleText[0] || "Captured product state";
  return event.label || event.text || event.selector || "Captured interaction";
};

const eventText = (event: EvidenceEvent) => {
  const parts = [eventLabel(event), event.selector, event.role, event.tagName, event.text];
  if (isSnapshotEvent(event)) {
    parts.push(event.title, ...event.visibleText, ...event.elements.flatMap((element) => [
      element.selector, element.role, element.label, element.text, element.tagName,
    ]));
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
};

const wordsFor = (value: string) =>
  value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2) ?? [];

const titleCase = (value: string) =>
  value.trim().replace(/\s+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

const shortSentence = (value: string, max = 70) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trim()}…`;
};

const evidenceFor = (
  events: EvidenceEvent[],
  query: string,
  fallback: EvidenceEvent,
  usedIds = new Set<string>(),
) => {
  const words = wordsFor(query);
  const phrase = query.toLowerCase().trim();
  const scored = events.map((event) => {
    const directText = [event.label, event.text, event.selector].filter(Boolean).join(" ").toLowerCase();
    const snapshotText = isSnapshotEvent(event)
      ? [...event.visibleText, ...event.elements.flatMap((element) => [element.label, element.text, element.selector])]
        .filter(Boolean).join(" ").toLowerCase()
      : "";
    const fullText = `${directText} ${snapshotText} ${eventText(event)}`;
    const directScore = words.reduce((sum, word) => sum + (directText.includes(word) ? 4 : 0), 0);
    const snapshotScore = words.reduce((sum, word) => sum + (snapshotText.includes(word) ? 1 : 0), 0);
    const phraseScore = phrase && fullText.includes(phrase) ? 6 : 0;
    const specificity = isSnapshotEvent(event) ? 0 : 1.25;
    const reusePenalty = usedIds.has(event.id) ? 5 : 0;
    const score = directScore + snapshotScore + phraseScore + specificity - reusePenalty;
    return {event, score};
  }).sort((left, right) => right.score - left.score || left.event.atMs - right.event.atMs);
  return scored[0]?.score > 0 ? scored[0].event : fallback;
};

const compactEvents = (capture: CaptureManifest) => {
  const useful = capture.events
    .filter(isInteractionEvent)
    .sort((left, right) => left.atMs - right.atMs);
  const selected: typeof useful = [];
  for (const event of useful) {
    const previous = selected.at(-1);
    if (previous && previous.selector === event.selector && event.atMs - previous.atMs < 1400) continue;
    selected.push(event);
  }
  return selected;
};

const direct = (projectId: string, brief: ProductBrief, capture: CaptureManifest): ScenePlan => {
  const interactions = compactEvents(capture);
  const snapshots = capture.events.filter(isSnapshotEvent).sort((left, right) => left.atMs - right.atMs);
  const evidenceEvents = [...interactions, ...snapshots].sort((left, right) => left.atMs - right.atMs);
  if (evidenceEvents.length === 0) {
    throw new Error("SceneGraph capture is missing UI evidence. The recorder did not provide snapshots or interaction anchors.");
  }
  const clicks = interactions.filter((event) => event.kind === "click");
  const firstEvidence = evidenceEvents[0];
  const firstInteraction = interactions[0] ?? firstEvidence;
  const secondEvidence = evidenceEvents.find((event) => event.atMs - firstEvidence.atMs > 3_000) ?? evidenceEvents[1] ?? firstEvidence;
  const earlyClick = clicks.find((event) => event.atMs - firstEvidence.atMs < 25_000) ?? clicks[0] ?? interactions[1] ?? secondEvidence;
  const journey = journeyName(brief, capture);
  const journeyBrief = brief.journey;
  const used = new Set<string>();
  const choose = (query: string, fallback: EvidenceEvent) => {
    const event = evidenceFor(evidenceEvents, query, fallback, used);
    used.add(event.id);
    return event;
  };
  const startEvent = journeyBrief ? choose(journeyBrief.startState, firstEvidence) : firstEvidence;
  const firstBeat = journeyBrief?.keyBeats[0];
  const secondBeat = journeyBrief?.keyBeats[1] ?? firstBeat;
  const thirdBeat = journeyBrief?.keyBeats[2] ?? secondBeat;
  const actionEvent = journeyBrief && firstBeat ? choose(firstBeat, earlyClick) : earlyClick;
  const outcomeEvent = journeyBrief && secondBeat ? choose(secondBeat, secondEvidence) : secondEvidence;
  const proofEvent = journeyBrief ? choose(`${journeyBrief.successState} ${thirdBeat ?? ""}`, outcomeEvent) : earlyClick;
  const scenes = [
    {
      role: "hook" as const,
      durationMs: 3200,
      headline: journeyBrief ? shortSentence(journeyBrief.goal, 56) : `${brief.productName} live control`,
      support: journeyBrief ? brief.productName : journey,
      eventId: startEvent.id,
      zoom: 1.08,
      rationale: journeyBrief
        ? "Introduce the declared demo goal using matching captured product state."
        : "Introduce the live product from recorder-supplied UI state instead of a synthetic title card.",
      observation: `The recorder captured the starting product state: ${eventLabel(startEvent)}.`,
    },
    {
      role: "problem" as const,
      durationMs: 3800,
      headline: journeyBrief ? shortSentence(journeyBrief.startState, 56) : "Spot the runtime state",
      support: journeyBrief ? "Start from the captured before state." : "Start from the real deployment surface.",
      eventId: startEvent.id,
      zoom: 1.18,
      rationale: "Use captured product evidence to establish the before state.",
      observation: `The before-state evidence is ${eventLabel(startEvent)}.`,
    },
    {
      role: "action" as const,
      durationMs: 4200,
      headline: firstBeat ? titleCase(shortSentence(firstBeat, 52)) : "Open the operational signal",
      support: "The cut follows captured UI evidence.",
      eventId: actionEvent.id,
      zoom: 1.34,
      rationale: "Match the first requested journey beat to recorder evidence.",
      observation: `The action beat is anchored to ${eventLabel(actionEvent)}.`,
    },
    {
      role: "outcome" as const,
      durationMs: 4200,
      headline: secondBeat ? titleCase(shortSentence(secondBeat, 52)) : "Inspect the evidence",
      support: journeyBrief ? "The next beat stays attached to the screen." : "Failure context stays attached to the screen.",
      eventId: outcomeEvent.id,
      zoom: 1.28,
      rationale: "Hold on the journey beat that explains what changed after the action.",
      observation: `The outcome beat appears at ${Math.round(outcomeEvent.atMs)}ms: ${eventLabel(outcomeEvent)}.`,
    },
    {
      role: "proof" as const,
      durationMs: 3600,
      headline: journeyBrief ? shortSentence(journeyBrief.successState, 56) : "Action stays in context",
      support: "Every claim is tied to captured UI evidence.",
      eventId: proofEvent.id,
      zoom: 1.18,
      rationale: "Close the preview on explainable recorder evidence rather than a generic marketing claim.",
      observation: `The proof beat references ${eventLabel(proofEvent)}.`,
    },
  ];
  let startMs = 0;
  const makeScene = (
    index: number,
    scene: typeof scenes[number],
  ): ScenePlan["scenes"][number] => {
    const event = capture.events.find((candidate) => candidate.id === scene.eventId);
    if (!event) {
      throw new Error(`SceneGraph refused to render the ${scene.role} scene because its evidence event is missing.`);
    }
    const rect = eventRect(event);
    const centerX = rect ? rect.x + rect.width / 2 : capture.viewport.width / 2;
    const centerY = rect ? rect.y + rect.height / 2 : capture.viewport.height / 2;
    const fromMs = event
      ? Math.max(0, Math.min(event.atMs - 1800, capture.durationMs - scene.durationMs - 1))
      : Math.max(0, Math.min(index * 3000, capture.durationMs - scene.durationMs - 1));
    const plannedStartMs = startMs;
    startMs += scene.durationMs;
    return {
      id: crypto.randomUUID(),
      role: scene.role,
      startMs: plannedStartMs,
      durationMs: scene.durationMs,
      headline: scene.headline,
      support: scene.support,
      rationale: scene.rationale,
      evidence: {
        kind: isSnapshotEvent(event) ? "state" : event.kind === "click" ? "transition" : "interaction",
        eventIds: [event.id],
        sourceMs: event.atMs,
        observation: scene.observation,
      },
      source: {fromMs, toMs: Math.min(fromMs + scene.durationMs, capture.durationMs)},
      camera: camera(scene.zoom, capture.viewport.width / 2 - centerX, capture.viewport.height / 2 - centerY),
      focusEventIds: rect ? [scene.eventId] : [],
      transition: index === 0 ? "cut" : index % 3 === 0 ? "match" : "mask",
    };
  };

  return {
    id: crypto.randomUUID(),
    projectId,
    title: `${brief.productName} launch`,
    fps: 60,
    width: 1920,
    height: 1080,
    brand: brief.brand,
    scenes: scenes.map((scene, index) => makeScene(index, scene)),
  };
};

const planHasSceneEvidence = (plan: ScenePlan | undefined) =>
  Boolean(plan?.scenes.every((scene) => "rationale" in scene && "evidence" in scene));

const app = Fastify({logger: true, trustProxy: true});
const dataRoot = path.resolve(process.env.SCENEGRAPH_DATA_DIR ?? "./data");
const mediaRoot = path.join(dataRoot, "media");
const renderRoot = path.resolve(process.env.RENDER_OUTPUT_DIR ?? "./renders");
await Promise.all([mkdir(dataRoot, {recursive: true}), mkdir(mediaRoot, {recursive: true}), mkdir(renderRoot, {recursive: true})]);
const objectStore = createObjectStoreFromEnv();

type StoredProject = {
  id: string;
  createdAt: string;
  brief: ProductBrief;
  captures: CaptureManifest[];
  plans: ScenePlan[];
  renderJobIds: string[];
};

const projectPath = (id: string) => path.join(dataRoot, `${id}.json`);
const loadProject = async (id: string): Promise<StoredProject> =>
  JSON.parse(await readFile(projectPath(id), "utf8")) as StoredProject;
const saveProject = async (project: StoredProject) => {
  const destination = projectPath(project.id);
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(project, null, 2));
  await rename(temporary, destination);
};

const accessToken = process.env.SCENEGRAPH_ACCESS_TOKEN?.trim();
if (process.env.NODE_ENV === "production" && !accessToken) {
  throw new Error("SCENEGRAPH_ACCESS_TOKEN is required in production");
}

const equalSecret = (left: string, right: string) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const signatureFor = (pathname: string) =>
  createHmac("sha256", accessToken ?? "scenegraph-local-development")
    .update(pathname)
    .digest("hex");

const signedAssetUrl = (request: {protocol: string; host: string}, pathname: string) => {
  const configured = process.env.SCENEGRAPH_PUBLIC_URL?.replace(/\/$/, "");
  const origin = configured || `${request.protocol}://${request.host}`;
  return `${origin}${pathname}?signature=${signatureFor(pathname)}`;
};

const captureUrl = async (
  request: {protocol: string; host: string},
  capture: CaptureManifest,
) => capture.assetKey && objectStore
  ? objectStore.signedGetUrl(capture.assetKey, 12 * 60 * 60)
  : capture.videoUrl;

app.addHook("onRequest", async (request, reply) => {
  const pathname = request.url.split("?", 1)[0];
  if (pathname.startsWith("/v1/")) {
    if (!accessToken) return;
    const authorization = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const extensionKey = String(request.headers["x-scenegraph-key"] ?? "");
    if (!equalSecret(authorization || extensionKey, accessToken)) {
      return reply.code(401).send({error: "A valid SceneGraph access token is required"});
    }
  }
  if (pathname.startsWith("/media/") || pathname.startsWith("/renders/")) {
    const {signature} = request.query as {signature?: string};
    if (!signature || !equalSecret(signature, signatureFor(pathname))) {
      return reply.code(401).send({error: "This asset link is invalid"});
    }
  }
});

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const queue = new Queue("scenegraph-renders", {
  connection: {host: redisUrl.hostname, port: Number(redisUrl.port || 6379)},
});

const remoteRenderUrl = process.env.MODAL_RENDER_URL?.trim();
if (remoteRenderUrl) {
  const remoteRenderToken = process.env.MODAL_RENDER_TOKEN?.trim();
  if (!remoteRenderToken) throw new Error("MODAL_RENDER_TOKEN is required when MODAL_RENDER_URL is set");
  new Worker("scenegraph-renders", async (queued) => {
    const job = renderJobSchema.parse(queued.data);
    const response = await fetch(remoteRenderUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${remoteRenderToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(job),
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    if (!response.ok) {
      const details = (await response.text()).slice(0, 500);
      throw new Error(`Remote renderer returned ${response.status}: ${details}`);
    }
    return renderResultSchema.parse(await response.json());
  }, {
    connection: {host: redisUrl.hostname, port: Number(redisUrl.port || 6379)},
    concurrency: 1,
  });
}

await app.register(cors, {
  origin: true,
  allowedHeaders: ["authorization", "content-type", "x-scenegraph-key"],
  methods: ["GET", "POST", "PUT", "OPTIONS"],
});
await app.register(fastifyStatic, {root: mediaRoot, prefix: "/media/", decorateReply: false});
await app.register(fastifyStatic, {root: renderRoot, prefix: "/renders/", decorateReply: false});
app.addContentTypeParser(["video/webm", "video/mp4", "application/octet-stream"], (_request, payload, done) => done(null, payload));
app.setErrorHandler((error, request, reply) => {
  if (error instanceof Error && error.name === "ZodError") {
    return reply.code(400).send({error: "The request does not match the SceneGraph contract"});
  }
  request.log.error(error);
  return reply.code(500).send({error: "SceneGraph could not complete the request"});
});

app.get("/health", async () => ({
  ok: true,
  service: "scenegraph-director",
  media: objectStore ? "r2" : "local",
  renderer: remoteRenderUrl ? "modal" : "local-worker",
}));

app.post("/v1/projects", async (request, reply) => {
  const brief = productBriefSchema.parse(request.body);
  const project: StoredProject = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    brief,
    captures: [],
    plans: [],
    renderJobIds: [],
  };
  await saveProject(project);
  return reply.code(201).send(project);
});

app.get("/v1/projects/:id", async (request, reply) => {
  const {id} = request.params as {id: string};
  try {
    return await loadProject(id);
  } catch {
    return reply.code(404).send({error: "Project not found"});
  }
});

app.put("/v1/projects/:id/brief", async (request, reply) => {
  const {id} = request.params as {id: string};
  const project = await loadProject(id);
  project.brief = productBriefSchema.parse(request.body);
  project.plans = [];
  await saveProject(project);
  return reply.code(200).send(project);
});

app.put("/v1/projects/:id/captures/:captureId/video", async (request, reply) => {
  const {id, captureId} = request.params as {id: string; captureId: string};
  await loadProject(id);
  if (!/^[0-9a-f-]{36}$/i.test(captureId)) return reply.code(400).send({error: "Capture ID must be a UUID"});
  const extension = request.headers["content-type"]?.includes("mp4") ? "mp4" : "webm";
  const assetKey = `captures/${id}/${captureId}.${extension}`;
  if (objectStore) {
    await objectStore.put(assetKey, request.body as Readable, `video/${extension}`);
    return reply.code(201).send({
      assetKey,
      videoUrl: await objectStore.signedGetUrl(assetKey, 12 * 60 * 60),
    });
  }
  const destination = path.join(mediaRoot, id, `${captureId}.${extension}`);
  await mkdir(path.dirname(destination), {recursive: true});
  const temporary = `${destination}.${crypto.randomUUID()}.upload`;
  await pipeline(request.body as Readable, createWriteStream(temporary, {flags: "wx"}));
  await rename(temporary, destination);
  const pathname = `/media/${id}/${captureId}.${extension}`;
  return reply.code(201).send({videoUrl: signedAssetUrl(request, pathname)});
});

app.post("/v1/projects/:id/captures", async (request, reply) => {
  const {id} = request.params as {id: string};
  const project = await loadProject(id);
  const capture = captureManifestSchema.parse(request.body);
  if (capture.projectId !== id) return reply.code(409).send({error: "Capture belongs to a different project"});
  project.captures.push(capture);
  await saveProject(project);
  return reply.code(201).send(capture);
});

const enqueueRender = async (
  request: {protocol: string; host: string},
  project: StoredProject,
  profile: "preview" | "master",
  existingPlan?: ScenePlan,
) => {
  const capture = project.captures.at(-1);
  if (!capture) return null;
  const plan = existingPlan ?? scenePlanSchema.parse(direct(project.id, project.brief, capture));
  const renderJob = renderJobSchema.parse({
    id: crypto.randomUUID(),
    projectId: project.id,
    capture: {...capture, videoUrl: await captureUrl(request, capture)},
    plan,
    output: profile === "preview"
      ? {profile, width: 1280, height: 720, fps: 30, codec: "h264", audioCodec: "aac", pixelFormat: "yuv420p"}
      : {profile, width: 1920, height: 1080, fps: 60, codec: "h264", audioCodec: "aac", pixelFormat: "yuv420p"},
  });
  await queue.add(`render-${profile}`, renderJob, {
    jobId: renderJob.id,
    removeOnComplete: {count: 100},
    removeOnFail: {count: 100},
  });
  if (!existingPlan) project.plans.push(plan);
  project.renderJobIds.push(renderJob.id);
  await saveProject(project);
  return {jobId: renderJob.id, plan, profile};
};

app.post("/v1/projects/:id/first-cut", async (request, reply) => {
  const {id} = request.params as {id: string};
  const project = await loadProject(id);
  const queued = await enqueueRender(request, project, "preview");
  if (!queued) return reply.code(409).send({error: "Record or upload a product journey first"});
  return reply.code(202).send(queued);
});

app.post("/v1/projects/:id/master", async (request, reply) => {
  const {id} = request.params as {id: string};
  const project = await loadProject(id);
  const plan = project.plans.at(-1);
  if (!plan) return reply.code(409).send({error: "Generate and review a first cut before rendering the master"});
  const queued = await enqueueRender(request, project, "master", planHasSceneEvidence(plan) ? plan : undefined);
  if (!queued) return reply.code(409).send({error: "Record or upload a product journey first"});
  return reply.code(202).send(queued);
});

app.get("/v1/projects/:id/renders/:jobId", async (request, reply) => {
  const {id, jobId} = request.params as {id: string; jobId: string};
  const project = await loadProject(id);
  if (!project.renderJobIds.includes(jobId)) return reply.code(404).send({error: "Render not found"});
  const job = await queue.getJob(jobId);
  if (!job) return reply.code(404).send({error: "Render job expired"});
  const state = await job.getState();
  const result = job.returnvalue ? renderResultSchema.parse(job.returnvalue) : undefined;
  const downloadUrl = result?.outputKey && objectStore
    ? await objectStore.signedGetUrl(result.outputKey)
    : result?.outputLocation
      ? signedAssetUrl(request, `/renders/${path.basename(result.outputLocation)}`)
      : undefined;
  return {
    jobId,
    state,
    progress: job.progress,
    error: job.failedReason || undefined,
    profile: result?.profile,
    downloadUrl,
  };
});
app.post("/v1/plan", async (request, reply) => {
  const body = request.body as Record<string, unknown>;
  const brief = productBriefSchema.parse(body.brief);
  const capture = captureManifestSchema.parse(body.capture);
  const plan = scenePlanSchema.parse(direct(String(body.projectId), brief, capture));
  return reply.code(201).send(plan);
});

await app.listen({host: "0.0.0.0", port: Number(process.env.DIRECTOR_PORT ?? 4100)});
