import path from "node:path";
import {createHmac, timingSafeEqual} from "node:crypto";
import {createWriteStream} from "node:fs";
import {mkdir, readFile, rename, writeFile} from "node:fs/promises";
import {pipeline} from "node:stream/promises";
import type {Readable} from "node:stream";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import {Queue} from "bullmq";
import {
  captureManifestSchema,
  productBriefSchema,
  scenePlanSchema,
  renderJobSchema,
  type CaptureManifest,
  type ProductBrief,
  type ScenePlan,
} from "@scenegraph/contracts";

const camera = (scale = 1, x = 0, y = 0) => ({
  from: {x: 0, y: 0, scale: 1},
  to: {x, y, scale},
  easing: "standard" as const,
});

const direct = (projectId: string, brief: ProductBrief, capture: CaptureManifest): ScenePlan => {
  const clicks = capture.events.filter((event) => event.kind === "click");
  const focus = capture.events.find((event) => event.kind === "focus" || event.kind === "input");
  const total = Math.max(capture.durationMs, 24_000);
  const beat = Math.floor(total / 7);
  const makeScene = (
    index: number,
    role: ScenePlan["scenes"][number]["role"],
    headline: string,
    support?: string,
    eventId?: string,
    zoom = 1,
  ): ScenePlan["scenes"][number] => {
    const event = capture.events.find((candidate) => candidate.id === eventId);
    const centerX = event?.rect ? event.rect.x + event.rect.width / 2 : capture.viewport.width / 2;
    const centerY = event?.rect ? event.rect.y + event.rect.height / 2 : capture.viewport.height / 2;
    return {
      id: crypto.randomUUID(),
      role,
      startMs: index * beat,
      durationMs: beat,
      headline,
      support,
      source: {fromMs: Math.min(index * beat, capture.durationMs - 1), toMs: Math.min((index + 1) * beat, capture.durationMs)},
      camera: camera(zoom, capture.viewport.width / 2 - centerX, capture.viewport.height / 2 - centerY),
      focusEventIds: eventId ? [eventId] : [],
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
    scenes: [
      makeScene(0, "hook", brief.launchPromise),
      makeScene(1, "problem", brief.customerProblem, `For ${brief.audience}`),
      makeScene(2, "action", "Watch the real workflow.", undefined, focus?.id, 1.7),
      makeScene(3, "outcome", "From intent to outcome—without the busywork.", undefined, clicks[0]?.id, 1.45),
      makeScene(4, "proof", "The result is visible, not implied.", undefined, clicks.at(-1)?.id, 1.55),
      makeScene(5, "fit", `Built for ${brief.audience}.`, undefined, undefined, 1.08),
      makeScene(6, "close", brief.launchPromise, brief.productName),
    ],
  };
};

const app = Fastify({logger: true, trustProxy: true});
const dataRoot = path.resolve(process.env.SCENEGRAPH_DATA_DIR ?? "./data");
const mediaRoot = path.join(dataRoot, "media");
const renderRoot = path.resolve(process.env.RENDER_OUTPUT_DIR ?? "./renders");
await Promise.all([mkdir(dataRoot, {recursive: true}), mkdir(mediaRoot, {recursive: true}), mkdir(renderRoot, {recursive: true})]);

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

app.get("/health", async () => ({ok: true, service: "scenegraph-director"}));

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

app.put("/v1/projects/:id/captures/:captureId/video", async (request, reply) => {
  const {id, captureId} = request.params as {id: string; captureId: string};
  await loadProject(id);
  if (!/^[0-9a-f-]{36}$/i.test(captureId)) return reply.code(400).send({error: "Capture ID must be a UUID"});
  const extension = request.headers["content-type"]?.includes("mp4") ? "mp4" : "webm";
  const destination = path.join(mediaRoot, `${captureId}.${extension}`);
  const temporary = `${destination}.${crypto.randomUUID()}.upload`;
  await pipeline(request.body as Readable, createWriteStream(temporary, {flags: "wx"}));
  await rename(temporary, destination);
  const pathname = `/media/${captureId}.${extension}`;
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

app.post("/v1/projects/:id/first-cut", async (request, reply) => {
  const {id} = request.params as {id: string};
  const project = await loadProject(id);
  const capture = project.captures.at(-1);
  if (!capture) return reply.code(409).send({error: "Record or upload a product journey first"});
  const plan = scenePlanSchema.parse(direct(id, project.brief, capture));
  const renderJob = renderJobSchema.parse({
    id: crypto.randomUUID(),
    projectId: id,
    capture,
    plan,
    output: {codec: "h264", audioCodec: "aac", pixelFormat: "yuv420p"},
  });
  await queue.add("render-first-cut", renderJob, {jobId: renderJob.id, removeOnComplete: false, removeOnFail: false});
  project.plans.push(plan);
  project.renderJobIds.push(renderJob.id);
  await saveProject(project);
  return reply.code(202).send({jobId: renderJob.id, plan});
});

app.get("/v1/projects/:id/renders/:jobId", async (request, reply) => {
  const {id, jobId} = request.params as {id: string; jobId: string};
  const project = await loadProject(id);
  if (!project.renderJobIds.includes(jobId)) return reply.code(404).send({error: "Render not found"});
  const job = await queue.getJob(jobId);
  if (!job) return reply.code(404).send({error: "Render job expired"});
  const state = await job.getState();
  const result = job.returnvalue as {outputLocation?: string} | undefined;
  return {
    jobId,
    state,
    progress: job.progress,
    error: job.failedReason || undefined,
    downloadUrl: result?.outputLocation
      ? signedAssetUrl(request, `/renders/${path.basename(result.outputLocation)}`)
      : undefined,
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
