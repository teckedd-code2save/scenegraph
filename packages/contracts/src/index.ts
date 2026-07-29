import {z} from "zod";

export const rectSchema = z.object({
  x: z.number(), y: z.number(),
  width: z.number().nonnegative(), height: z.number().nonnegative(),
});

export const productBriefSchema = z.object({
  productName: z.string().min(1),
  productUrl: z.string().url(),
  customerProblem: z.string().min(12),
  audience: z.string().min(3),
  launchPromise: z.string().min(8),
  tone: z.enum(["precise", "bold", "warm", "technical"]).default("precise"),
  brand: z.object({
    primary: z.string().regex(/^#[0-9a-f]{6}$/i),
    surface: z.string().regex(/^#[0-9a-f]{6}$/i),
    ink: z.string().regex(/^#[0-9a-f]{6}$/i),
  }),
});

const eventBase = z.object({
  id: z.string().uuid(),
  atMs: z.number().nonnegative(),
  selector: z.string().optional(),
  rect: rectSchema.optional(),
});

export const captureEventSchema = z.discriminatedUnion("kind", [
  eventBase.extend({kind: z.literal("click"), button: z.number().int().min(0).max(4)}),
  eventBase.extend({kind: z.literal("input"), value: z.string(), masked: z.boolean()}),
  eventBase.extend({kind: z.literal("focus")}),
  eventBase.extend({kind: z.literal("scroll"), x: z.number(), y: z.number()}),
  eventBase.extend({kind: z.literal("navigation"), url: z.string().url()}),
]);

export const captureManifestSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  sourceUrl: z.string().url(),
  startedAt: z.string().datetime(),
  durationMs: z.number().positive(),
  viewport: z.object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    deviceScaleFactor: z.number().positive(),
  }),
  videoUrl: z.string().url(),
  events: z.array(captureEventSchema),
});

const cameraSchema = z.object({
  from: z.object({x: z.number(), y: z.number(), scale: z.number().min(1)}),
  to: z.object({x: z.number(), y: z.number(), scale: z.number().min(1)}),
  easing: z.enum(["standard", "ease-in", "ease-out", "spring"]),
});

export const scenePlanSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  title: z.string().min(1),
  fps: z.literal(60),
  width: z.literal(1920),
  height: z.literal(1080),
  brand: productBriefSchema.shape.brand,
  scenes: z.array(z.object({
    id: z.string().uuid(),
    role: z.enum(["hook", "problem", "action", "outcome", "proof", "fit", "close"]),
    startMs: z.number().nonnegative(),
    durationMs: z.number().positive(),
    headline: z.string().max(72),
    support: z.string().max(140).optional(),
    source: z.object({fromMs: z.number().nonnegative(), toMs: z.number().positive()}).optional(),
    camera: cameraSchema,
    focusEventIds: z.array(z.string().uuid()),
    transition: z.enum(["cut", "match", "mask", "dissolve"]),
  })).min(3),
});

export const renderJobSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  capture: captureManifestSchema,
  plan: scenePlanSchema,
  output: z.object({
    codec: z.literal("h264"),
    pixelFormat: z.literal("yuv420p"),
    audioCodec: z.literal("aac"),
  }),
});

export type ProductBrief = z.infer<typeof productBriefSchema>;
export type CaptureEvent = z.infer<typeof captureEventSchema>;
export type CaptureManifest = z.infer<typeof captureManifestSchema>;
export type ScenePlan = z.infer<typeof scenePlanSchema>;
export type RenderJob = z.infer<typeof renderJobSchema>;
