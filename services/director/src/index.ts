import Fastify from "fastify";
import {
  captureManifestSchema,
  productBriefSchema,
  scenePlanSchema,
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

const app = Fastify({logger: true});
app.get("/health", async () => ({ok: true, service: "scenegraph-director"}));
app.post("/v1/plan", async (request, reply) => {
  const body = request.body as Record<string, unknown>;
  const brief = productBriefSchema.parse(body.brief);
  const capture = captureManifestSchema.parse(body.capture);
  const plan = scenePlanSchema.parse(direct(String(body.projectId), brief, capture));
  return reply.code(201).send(plan);
});

await app.listen({host: "0.0.0.0", port: Number(process.env.DIRECTOR_PORT ?? 4100)});
