import path from "node:path";
import {spawn} from "node:child_process";
import {createHmac, timingSafeEqual} from "node:crypto";
import {createReadStream, createWriteStream} from "node:fs";
import {mkdir, readFile, readdir, rename, stat, unlink, writeFile} from "node:fs/promises";
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

const defaultJourney = (brief: ProductBrief): NonNullable<ProductBrief["journey"]> => ({
  goal: `Show how ${brief.productName} turns ${brief.customerProblem.toLowerCase()} into ${brief.launchPromise.toLowerCase()}.`,
  startState: brief.customerProblem,
  keyBeats: [
    "Show the starting product state",
    "Follow the decisive product action",
    "Inspect the changed product evidence",
  ],
  successState: brief.launchPromise,
  avoid: "Do not use generic scenes or claims that are not visible in captured product evidence.",
});

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
type EvidenceMatch = {
  event: EvidenceEvent;
  score: number;
  grade: "strong" | "usable" | "weak" | "missing";
  matchedWords: string[];
  reason: string;
  kind: "state" | "transition" | "interaction";
};

class PlanningError extends Error {
  statusCode: number;
  details?: unknown;
  constructor(message: string, statusCode = 409, details?: unknown) {
    super(message);
    this.name = "PlanningError";
    this.statusCode = statusCode;
    this.details = details;
  }
}

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

type GraphNode = {
  id: string;
  event: EvidenceEvent;
  atMs: number;
  label: string;
  text: string;
  tokens: Set<string>;
  quality: number;
};
type GraphEdge = {
  id: string;
  from: GraphNode;
  to: GraphNode;
  event: EvidenceEvent;
  label: string;
  text: string;
  tokens: Set<string>;
  quality: number;
};
type StateGraph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  events: EvidenceEvent[];
};

const stopWords = new Set([
  "the", "and", "for", "with", "that", "this", "from", "into", "onto", "your", "you",
  "how", "show", "visible", "product", "screen", "state", "current", "specific",
]);

const wordsFor = (value: string) =>
  value.toLowerCase().match(/[a-z0-9]+/g)?.filter((word) => word.length > 2 && !stopWords.has(word)) ?? [];

const tokenSet = (value: string) => new Set(wordsFor(value));

const tokenHits = (tokens: Set<string>, words: string[]) =>
  words.filter((word) => tokens.has(word) || Array.from(tokens).some((token) => token.includes(word) || word.includes(token)));

const textQuality = (text: string, event?: EvidenceEvent) => {
  const tokens = tokenSet(text);
  const direct = event && !isSnapshotEvent(event) ? 2 : 0;
  const visual = event && eventRect(event) ? 1 : 0;
  return Math.min(10, tokens.size / 7 + direct + visual);
};

const nearestNode = (nodes: GraphNode[], atMs: number, direction: "before" | "after") => {
  const candidates = nodes
    .filter((node) => direction === "before" ? node.atMs <= atMs : node.atMs >= atMs)
    .sort((left, right) => direction === "before" ? right.atMs - left.atMs : left.atMs - right.atMs);
  return candidates[0] ?? nodes.sort((left, right) => Math.abs(left.atMs - atMs) - Math.abs(right.atMs - atMs))[0];
};

const buildStateGraph = (capture: CaptureManifest): StateGraph => {
  const evidenceEvents = capture.events.filter((event): event is EvidenceEvent => Boolean(eventRect(event) || isSnapshotEvent(event)))
    .sort((left, right) => left.atMs - right.atMs);
  const nodes = evidenceEvents
    .filter(isSnapshotEvent)
    .map((event) => {
      const text = eventText(event);
      return {
        id: event.id,
        event,
        atMs: event.atMs,
        label: eventLabel(event),
        text,
        tokens: tokenSet(text),
        quality: textQuality(text, event),
      };
    });
  const edges: GraphEdge[] = [];
  for (const event of evidenceEvents.filter((candidate) => !isSnapshotEvent(candidate))) {
      const from = nearestNode(nodes, event.atMs, "before");
      const to = nearestNode(nodes, event.atMs, "after");
      if (!from || !to) continue;
      const text = eventText(event);
      edges.push({
        id: event.id,
        from,
        to,
        event,
        label: eventLabel(event),
        text,
        tokens: tokenSet(text),
        quality: textQuality(text, event) + (to.id !== from.id ? 2 : 0),
      });
  }
  return {nodes, edges, events: evidenceEvents};
};

const gradeFor = (score: number): EvidenceMatch["grade"] =>
  score >= 9 ? "strong" : score >= 5 ? "usable" : score > 0 ? "weak" : "missing";

const titleCase = (value: string) =>
  value.trim().replace(/\s+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());

const shortSentence = (value: string, max = 70) => {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1).trim()}…`;
};

const scoreEvidenceText = (
  query: string,
  text: string,
  tokens: Set<string>,
  quality: number,
  reusePenalty: number,
) => {
  const words = wordsFor(query);
  const phrase = query.toLowerCase().trim();
  const hits = tokenHits(tokens, words);
  if (words.length > 0 && hits.length === 0) return {score: 0, matchedWords: hits};
  const phraseScore = phrase && text.includes(phrase) ? 6 : 0;
  const coverage = words.length ? hits.length / words.length : 0;
  return {
    score: hits.length * 2.2 + coverage * 5 + phraseScore + quality - reusePenalty,
    matchedWords: hits,
  };
};

const evidenceFor = (
  graph: StateGraph,
  query: string,
  fallback: EvidenceEvent,
  usedIds = new Set<string>(),
): EvidenceMatch => {
  const nodeScores = graph.nodes.map((node) => {
    const result = scoreEvidenceText(query, node.text, node.tokens, node.quality, usedIds.has(node.id) ? 5 : 0);
    return {
      event: node.event,
      score: result.score,
      matchedWords: result.matchedWords,
      reason: `state "${node.label}" matched ${result.matchedWords.join(", ") || "no query terms"}`,
      kind: "state" as const,
    };
  });
  const edgeScores = graph.edges.map((edge) => {
    const text = `${edge.text} ${edge.from.text} ${edge.to.text}`;
    const tokens = new Set([...edge.tokens, ...edge.from.tokens, ...edge.to.tokens]);
    const result = scoreEvidenceText(query, text, tokens, edge.quality, usedIds.has(edge.id) ? 5 : 0);
    return {
      event: edge.event,
      score: result.score > 0 ? result.score + (edge.to.id !== edge.from.id ? 1.5 : 0) : 0,
      matchedWords: result.matchedWords,
      reason: `transition "${edge.label}" connects "${edge.from.label}" to "${edge.to.label}"`,
      kind: "transition" as const,
    };
  });
  const scored = [...nodeScores, ...edgeScores].sort((left, right) => right.score - left.score || left.event.atMs - right.event.atMs);
  const best = scored[0];
  const score = best?.score && best.score > 0 ? best.score : 0;
  const event = score > 0 ? best.event : fallback;
  return {
    event,
    score,
    grade: gradeFor(score),
    matchedWords: score > 0 ? best.matchedWords : [],
    reason: score > 0 ? best.reason : "no graph evidence matched this beat",
    kind: score > 0 ? best.kind : "state",
  };
};

const assertUsableJourneyEvidence = (matches: Array<{label: string; match: EvidenceMatch}>) => {
  const missing = matches.filter(({match}) => match.grade === "weak" || match.grade === "missing");
  const distinctEvidence = new Set(matches.map(({match}) => match.event.id));
  const thinStory = distinctEvidence.size < Math.min(3, matches.length);
  const weakStory = [
    ...(thinStory ? [{label: "story progression", match: matches[0].match, reason: "too many beats point to the same captured state"}] : []),
  ];
  if (missing.length === 0 && weakStory.length === 0) return;
  const diagnostics = [...missing.map(({label, match}) => ({label, match, reason: match.reason})), ...weakStory]
    .map(({label, match, reason}) => ({
    label,
    grade: match.grade,
    score: Number(match.score.toFixed(2)),
    matchedWords: match.matchedWords,
    reason,
  }));
  throw new PlanningError(
    "This walkthrough is missing a few moments needed for a complete story.",
    409,
    {missing: diagnostics},
  );
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
  const graph = buildStateGraph(capture);
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
  const journeyBrief = brief.journey ?? defaultJourney(brief);
  const used = new Set<string>();
  const choose = (query: string, fallback: EvidenceEvent) => {
    const match = evidenceFor(graph, query, fallback, used);
    used.add(match.event.id);
    return match;
  };
  const startMatch = journeyBrief ? choose(journeyBrief.startState, firstEvidence) : undefined;
  const startEvent = startMatch?.event ?? firstEvidence;
  const firstBeat = journeyBrief?.keyBeats[0];
  const secondBeat = journeyBrief?.keyBeats[1] ?? firstBeat;
  const thirdBeat = journeyBrief?.keyBeats[2] ?? secondBeat;
  const actionMatch = journeyBrief && firstBeat ? choose(firstBeat, earlyClick) : undefined;
  const outcomeMatch = journeyBrief && secondBeat ? choose(secondBeat, secondEvidence) : undefined;
  const proofMatch = journeyBrief ? choose(`${journeyBrief.successState} ${thirdBeat ?? ""}`, outcomeMatch?.event ?? secondEvidence) : undefined;
  const actionEvent = actionMatch?.event ?? earlyClick;
  const outcomeEvent = outcomeMatch?.event ?? secondEvidence;
  const proofEvent = proofMatch?.event ?? earlyClick;
  if (journeyBrief) {
    assertUsableJourneyEvidence([
      {label: `start state: ${journeyBrief.startState}`, match: startMatch!},
      ...(firstBeat ? [{label: `beat: ${firstBeat}`, match: actionMatch!}] : []),
      ...(secondBeat ? [{label: `beat: ${secondBeat}`, match: outcomeMatch!}] : []),
      {label: `success state: ${journeyBrief.successState}`, match: proofMatch!},
    ]);
  }
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
      observation: startMatch
        ? `Graph evidence ${startMatch.grade}: ${startMatch.reason}.`
        : `The recorder captured the starting product state: ${eventLabel(startEvent)}.`,
    },
    {
      role: "problem" as const,
      durationMs: 3800,
      headline: journeyBrief ? shortSentence(journeyBrief.startState, 56) : "Spot the runtime state",
      support: journeyBrief ? "Start from the captured before state." : "Start from the real product surface.",
      eventId: startEvent.id,
      zoom: 1.18,
      rationale: "Use captured product evidence to establish the before state.",
      observation: startMatch
        ? `Before-state evidence ${startMatch.grade}: ${startMatch.reason}.`
        : `The before-state evidence is ${eventLabel(startEvent)}.`,
    },
    {
      role: "action" as const,
      durationMs: 4200,
      headline: firstBeat ? titleCase(shortSentence(firstBeat, 52)) : "Open the operational signal",
      support: "The cut follows captured UI evidence.",
      eventId: actionEvent.id,
      zoom: 1.34,
      rationale: "Match the first requested journey beat to recorder evidence.",
      observation: actionMatch
        ? `Action evidence ${actionMatch.grade}: ${actionMatch.reason}.`
        : `The action beat is anchored to ${eventLabel(actionEvent)}.`,
    },
    {
      role: "outcome" as const,
      durationMs: 4200,
      headline: secondBeat ? titleCase(shortSentence(secondBeat, 52)) : "Inspect the evidence",
      support: journeyBrief ? "The next beat stays attached to the screen." : "Failure context stays attached to the screen.",
      eventId: outcomeEvent.id,
      zoom: 1.28,
      rationale: "Hold on the journey beat that explains what changed after the action.",
      observation: outcomeMatch
        ? `Outcome evidence ${outcomeMatch.grade}: ${outcomeMatch.reason}.`
        : `The outcome beat appears at ${Math.round(outcomeEvent.atMs)}ms: ${eventLabel(outcomeEvent)}.`,
    },
    {
      role: "proof" as const,
      durationMs: 3600,
      headline: journeyBrief ? shortSentence(journeyBrief.successState, 56) : "Action stays in context",
      support: "Every claim is tied to captured UI evidence.",
      eventId: proofEvent.id,
      zoom: 1.18,
      rationale: "Close the preview on explainable recorder evidence rather than a generic marketing claim.",
      observation: proofMatch
        ? `Proof evidence ${proofMatch.grade}: ${proofMatch.reason}.`
        : `The proof beat references ${eventLabel(proofEvent)}.`,
    },
  ];
  const configuredMaxPreviewMs = Number(process.env.SCENEGRAPH_PREVIEW_MAX_MS ?? 90_000);
  const maxPreviewMs = Number.isFinite(configuredMaxPreviewMs) && configuredMaxPreviewMs > 0
    ? configuredMaxPreviewMs
    : 90_000;
  const baseDurationMs = scenes.reduce((total, scene) => total + scene.durationMs, 0);
  const evidenceDurationMs = Math.max(0, ...capture.events.map((event) => event.atMs));
  const capturedDurationMs = Math.max(capture.durationMs || 0, evidenceDurationMs);
  const targetDurationMs = Math.max(baseDurationMs, Math.min(capturedDurationMs || baseDurationMs, maxPreviewMs));
  const durationScale = targetDurationMs / baseDurationMs;
  let assignedDurationMs = 0;
  const expandedScenes = scenes.map((scene, index) => {
    const durationMs = index === scenes.length - 1
      ? Math.max(1000, targetDurationMs - assignedDurationMs)
      : Math.max(scene.durationMs, Math.round(scene.durationMs * durationScale));
    assignedDurationMs += durationMs;
    return {...scene, durationMs};
  });
  let startMs = 0;
  const makeScene = (
    index: number,
    scene: typeof expandedScenes[number],
  ): ScenePlan["scenes"][number] => {
    const event = capture.events.find((candidate) => candidate.id === scene.eventId);
    if (!event) {
      throw new Error(`SceneGraph refused to render the ${scene.role} scene because its evidence event is missing.`);
    }
    const rect = eventRect(event);
    const centerX = rect ? rect.x + rect.width / 2 : capture.viewport.width / 2;
    const centerY = rect ? rect.y + rect.height / 2 : capture.viewport.height / 2;
    const plannedStartMs = startMs;
    startMs += scene.durationMs;
    const sourceDurationMs = capturedDurationMs || scene.durationMs;
    const fromMs = Math.max(0, Math.min(plannedStartMs, Math.max(0, sourceDurationMs - scene.durationMs)));
    const toMs = Math.min(fromMs + scene.durationMs, sourceDurationMs);
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
      source: {fromMs, toMs},
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
    scenes: expandedScenes.map((scene, index) => makeScene(index, scene)),
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

const run = (command: string, args: string[]) => new Promise<void>((resolve, reject) => {
  const child = spawn(command, args, {stdio: ["ignore", "ignore", "pipe"]});
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.slice(-1000) || `${command} exited ${code}`)));
});

const normalizeCaptureVideo = async (input: string, extension: "mp4" | "webm") => {
  if (extension !== "webm") return {path: input, extension};
  const output = `${input}.normalized.webm`;
  await run("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-fflags", "+genpts", "-i", input, "-c", "copy", output]);
  await unlink(input).catch(() => undefined);
  return {path: output, extension};
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

const renderStatus = async (
  request: {protocol: string; host: string},
  jobId: string,
) => {
  const localRender = async () => {
    for (const profile of ["master", "preview"] as const) {
      const outputLocation = path.join(renderRoot, `${jobId}-${profile}.mp4`);
      const ready = await stat(outputLocation).then((file) => file.size > 0).catch(() => false);
      if (ready) {
        return {
          jobId,
          state: "completed" as const,
          progress: 100,
          profile,
          downloadUrl: signedAssetUrl(request, `/renders/${path.basename(outputLocation)}`),
        };
      }
    }
    return undefined;
  };

  const job = await queue.getJob(jobId);
  if (!job) return localRender() ?? {jobId, state: "expired" as const};
  const state = await job.getState();
  const result = job.returnvalue ? renderResultSchema.parse(job.returnvalue) : undefined;
  const localOutputReady = result?.outputLocation
    ? await stat(result.outputLocation).then((file) => file.size > 0).catch(() => false)
    : false;
  const downloadUrl = result?.outputKey && objectStore
    ? await objectStore.signedGetUrl(result.outputKey)
    : result?.outputLocation && localOutputReady
      ? signedAssetUrl(request, `/renders/${path.basename(result.outputLocation)}`)
      : undefined;
  if (!downloadUrl && state === "completed") return localRender() ?? {jobId, state: "expired" as const};
  return {
    jobId,
    state,
    progress: job.progress,
    error: job.failedReason || undefined,
    profile: result?.profile,
    downloadUrl,
  };
};

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
  if (error instanceof PlanningError) {
    return reply.code(error.statusCode).send({error: error.message, details: error.details});
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

app.get("/v1/projects", async () => {
  const files = await readdir(dataRoot).catch(() => []);
  const projects = await Promise.all(files
    .filter((file) => file.endsWith(".json"))
    .map(async (file) => {
      const project = await loadProject(path.basename(file, ".json"));
      return {
        id: project.id,
        createdAt: project.createdAt,
        productName: project.brief.productName,
        productUrl: project.brief.productUrl,
        launchPromise: project.brief.launchPromise,
        captures: project.captures.length,
        renders: project.renderJobIds.length,
      };
    }));
  return projects.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
});

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
    const project = await loadProject(id);
    const renders = await Promise.all(project.renderJobIds.slice(-10).map((jobId) => renderStatus(request, jobId)));
    return {...project, renders};
  } catch {
    return reply.code(404).send({error: "Project not found"});
  }
});

app.get("/v1/projects/:id/analysis", async (request, reply) => {
  const {id} = request.params as {id: string};
  const project = await loadProject(id);
  const capture = project.captures.at(-1);
  if (!capture) return reply.code(409).send({error: "Record or upload a product journey first"});
  const graph = buildStateGraph(capture);
  return {
    nodes: graph.nodes.map((node) => ({
      id: node.id,
      atMs: node.atMs,
      label: node.label,
      quality: Number(node.quality.toFixed(2)),
      preview: shortSentence(node.text, 180),
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      atMs: edge.event.atMs,
      label: edge.label,
      from: edge.from.label,
      to: edge.to.label,
      quality: Number(edge.quality.toFixed(2)),
    })),
  };
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
  const uploadDir = path.join(mediaRoot, id);
  await mkdir(uploadDir, {recursive: true});
  const upload = path.join(uploadDir, `${captureId}.${extension}.${crypto.randomUUID()}.upload`);
  await pipeline(request.body as Readable, createWriteStream(upload, {flags: "wx"}));
  const normalized = await normalizeCaptureVideo(upload, extension);
  const assetKey = `captures/${id}/${captureId}.${normalized.extension}`;
  if (objectStore) {
    await objectStore.put(assetKey, createReadStream(normalized.path), `video/${normalized.extension}`);
    await unlink(normalized.path).catch(() => undefined);
    return reply.code(201).send({
      assetKey,
      videoUrl: await objectStore.signedGetUrl(assetKey, 12 * 60 * 60),
    });
  }
  const destination = path.join(uploadDir, `${captureId}.${normalized.extension}`);
  await rename(normalized.path, destination);
  const pathname = `/media/${id}/${captureId}.${normalized.extension}`;
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
  const status = await renderStatus(request, jobId);
  if (!status || (status as {state?: string}).state === "expired") return reply.code(404).send({error: "Render job expired"});
  return status;
});
app.post("/v1/plan", async (request, reply) => {
  const body = request.body as Record<string, unknown>;
  const brief = productBriefSchema.parse(body.brief);
  const capture = captureManifestSchema.parse(body.capture);
  const plan = scenePlanSchema.parse(direct(String(body.projectId), brief, capture));
  return reply.code(201).send(plan);
});

await app.listen({host: "0.0.0.0", port: Number(process.env.DIRECTOR_PORT ?? 4100)});
