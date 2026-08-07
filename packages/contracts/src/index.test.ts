import {describe, expect, it} from "vitest";
import {z} from "zod";
import {
  captureManifestSchema,
  productBriefSchema,
  renderJobSchema,
  scenePlanSchema,
  type CaptureManifest,
  type ProductBrief,
  type ScenePlan,
} from "./index.js";

const PROJECT_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const CAPTURE_ID = "a1b2c3d4-0000-4000-8000-000000000002";
const PLAN_ID = "a1b2c3d4-0000-4000-8000-000000000003";
const SCENE_A_ID = "a1b2c3d4-0000-4000-8000-000000000004";
const SCENE_B_ID = "a1b2c3d4-0000-4000-8000-000000000005";
const SCENE_C_ID = "a1b2c3d4-0000-4000-8000-000000000006";
const EVENT_ID = "a1b2c3d4-0000-4000-8000-000000000007";

const BRIEF: ProductBrief = {
  productName: "Serendepify",
  productUrl: "https://serendepify.com",
  customerProblem: "Founders lose hours to manual busywork",
  audience: "founders",
  launchPromise: "Ship with less busywork",
  tone: "precise",
  brand: {primary: "#00E699", surface: "#000000", ink: "#FFFFFF"},
};

const CAPTURE: CaptureManifest = {
  id: CAPTURE_ID,
  projectId: PROJECT_ID,
  sourceUrl: "https://serendepify.com/onboarding",
  startedAt: "2026-08-07T09:00:00.000Z",
  durationMs: 30_000,
  viewport: {width: 1920, height: 1080, deviceScaleFactor: 1},
  videoUrl: "https://media.example.com/capture.webm",
  events: [{id: EVENT_ID, atMs: 2_000, kind: "click", button: 0, rect: {x: 100, y: 100, width: 80, height: 40}}],
};

const scene = (id: string, role: ScenePlan["scenes"][number]["role"]): ScenePlan["scenes"][number] => ({
  id,
  role,
  startMs: 0,
  durationMs: 3428,
  headline: "Ship with less busywork",
  camera: {from: {x: 0, y: 0, scale: 1}, to: {x: 0, y: 0, scale: 1}, easing: "standard"},
  focusEventIds: [],
  transition: "cut",
  source: {fromMs: 0, toMs: 3428},
});

const PLAN: ScenePlan = {
  id: PLAN_ID,
  projectId: PROJECT_ID,
  title: "Serendepify launch",
  fps: 60,
  width: 1920,
  height: 1080,
  brand: BRIEF.brand,
  scenes: [scene(SCENE_A_ID, "hook"), scene(SCENE_B_ID, "problem"), scene(SCENE_C_ID, "close")],
};

const issuesOf = (parse: () => unknown): z.ZodIssue[] => {
  try {
    parse();
    throw new Error("expected the schema to reject this input");
  } catch (error) {
    expect(error).toBeInstanceOf(z.ZodError);
    return (error as z.ZodError).issues;
  }
};

describe("captureManifestSchema", () => {
  it("accepts a valid capture manifest", () => {
    expect(captureManifestSchema.parse(CAPTURE)).toEqual(CAPTURE);
  });

  it("rejects a manifest missing a required field with a helpful path", () => {
    const {durationMs: _durationMs, ...withoutDuration} = CAPTURE;
    const issues = issuesOf(() => captureManifestSchema.parse(withoutDuration));
    expect(issues.some((issue) => issue.path.join(".") === "durationMs")).toBe(true);
  });

  it("rejects a non-positive duration", () => {
    const issues = issuesOf(() => captureManifestSchema.parse({...CAPTURE, durationMs: 0}));
    expect(issues.some((issue) => issue.path.join(".") === "durationMs")).toBe(true);
  });

  it("rejects an unknown event kind", () => {
    const issues = issuesOf(() =>
      captureManifestSchema.parse({
        ...CAPTURE,
        events: [{id: EVENT_ID, atMs: 2_000, kind: "drag"}],
      }),
    );
    expect(issues.some((issue) => issue.path.join(".").startsWith("events"))).toBe(true);
  });

  it("rejects a click event without its button field", () => {
    const issues = issuesOf(() =>
      captureManifestSchema.parse({
        ...CAPTURE,
        events: [{id: EVENT_ID, atMs: 2_000, kind: "click"}],
      }),
    );
    expect(issues.some((issue) => issue.path.join(".") === "events.0.button")).toBe(true);
  });

  it("rejects a negative rect width", () => {
    const issues = issuesOf(() =>
      captureManifestSchema.parse({
        ...CAPTURE,
        events: [{id: EVENT_ID, atMs: 2_000, kind: "click", button: 0, rect: {x: 0, y: 0, width: -1, height: 40}}],
      }),
    );
    expect(issues.some((issue) => issue.path.join(".") === "events.0.rect.width")).toBe(true);
  });

  it("rejects a non-URL sourceUrl", () => {
    const issues = issuesOf(() => captureManifestSchema.parse({...CAPTURE, sourceUrl: "not a url"}));
    expect(issues.some((issue) => issue.path.join(".") === "sourceUrl")).toBe(true);
  });
});

describe("productBriefSchema", () => {
  it("accepts a valid brief and defaults the tone to precise", () => {
    expect(productBriefSchema.parse(BRIEF).tone).toBe("precise");
  });

  it("rejects an invalid hex brand colour", () => {
    const issues = issuesOf(() =>
      productBriefSchema.parse({...BRIEF, brand: {...BRIEF.brand, primary: "#00E69G"}}),
    );
    expect(issues.some((issue) => issue.path.join(".") === "brand.primary")).toBe(true);
  });

  it("rejects a customer problem that is too short to be meaningful", () => {
    const issues = issuesOf(() => productBriefSchema.parse({...BRIEF, customerProblem: "Too short"}));
    expect(issues.some((issue) => issue.path.join(".") === "customerProblem")).toBe(true);
  });
});

describe("scenePlanSchema", () => {
  it("accepts a valid scene plan", () => {
    expect(scenePlanSchema.parse(PLAN)).toEqual(PLAN);
  });

  it("rejects a plan with fewer than three scenes", () => {
    const issues = issuesOf(() => scenePlanSchema.parse({...PLAN, scenes: PLAN.scenes.slice(0, 2)}));
    expect(issues.some((issue) => issue.path.join(".") === "scenes")).toBe(true);
  });

  it("rejects a scene with an unknown transition", () => {
    const issues = issuesOf(() =>
      scenePlanSchema.parse({
        ...PLAN,
        scenes: [{...PLAN.scenes[0], transition: "wipe"}],
      }),
    );
    expect(issues.some((issue) => issue.path.join(".") === "scenes.0.transition")).toBe(true);
  });
});

describe("renderJobSchema", () => {
  it("accepts a valid render job", () => {
    const job = {
      id: PLAN_ID,
      projectId: PROJECT_ID,
      capture: CAPTURE,
      plan: PLAN,
      output: {codec: "h264", pixelFormat: "yuv420p", audioCodec: "aac"},
    };
    expect(renderJobSchema.parse(job)).toEqual(job);
  });

  it("rejects a render job with a non-h264 codec", () => {
    const issues = issuesOf(() =>
      renderJobSchema.parse({
        id: PLAN_ID,
        projectId: PROJECT_ID,
        capture: CAPTURE,
        plan: PLAN,
        output: {codec: "vp9", pixelFormat: "yuv420p", audioCodec: "aac"},
      }),
    );
    expect(issues.some((issue) => issue.path.join(".") === "output.codec")).toBe(true);
  });
});
