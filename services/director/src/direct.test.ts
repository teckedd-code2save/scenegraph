import {describe, expect, it} from "vitest";
import {direct} from "./direct.js";
import {
  captureManifestSchema,
  scenePlanSchema,
  type CaptureEvent,
  type CaptureManifest,
  type ProductBrief,
  type ScenePlan,
} from "@scenegraph/contracts";

const PROJECT_ID = "a1b2c3d4-0000-4000-8000-000000000001";
const CAPTURE_ID = "a1b2c3d4-0000-4000-8000-000000000002";
const FOCUS_ID = "a1b2c3d4-0000-4000-8000-000000000003";
const INPUT_ID = "a1b2c3d4-0000-4000-8000-000000000004";
const CLICK_A_ID = "a1b2c3d4-0000-4000-8000-000000000005";
const CLICK_B_ID = "a1b2c3d4-0000-4000-8000-000000000006";
const SCROLL_A_ID = "a1b2c3d4-0000-4000-8000-000000000007";
const SCROLL_B_ID = "a1b2c3d4-0000-4000-8000-000000000008";

const BRIEF: ProductBrief = {
  productName: "Serendepify",
  productUrl: "https://serendepify.com",
  customerProblem: "Founders lose hours to manual busywork",
  audience: "founders",
  launchPromise: "Ship with less busywork",
  tone: "precise",
  brand: {primary: "#00E699", surface: "#000000", ink: "#FFFFFF"},
};

const click = (id: string, atMs: number, x: number, y: number): CaptureEvent => ({
  id,
  atMs,
  kind: "click",
  button: 0,
  rect: {x, y, width: 80, height: 40},
});

const focus = (id: string, atMs: number, x: number, y: number): CaptureEvent => ({
  id,
  atMs,
  kind: "focus",
  rect: {x, y, width: 200, height: 60},
});

const input = (id: string, atMs: number): CaptureEvent => ({id, atMs, kind: "input", value: "hello", masked: false});

const scroll = (id: string, atMs: number): CaptureEvent => ({id, atMs, kind: "scroll", x: 0, y: 500});

const makeCapture = (overrides: Partial<CaptureManifest> = {}, events: CaptureEvent[] = []): CaptureManifest =>
  captureManifestSchema.parse({
    id: CAPTURE_ID,
    projectId: PROJECT_ID,
    sourceUrl: "https://serendepify.com/onboarding",
    startedAt: "2026-08-07T09:00:00.000Z",
    durationMs: 30_000,
    viewport: {width: 1920, height: 1080, deviceScaleFactor: 1},
    videoUrl: "https://media.example.com/capture.webm",
    events,
    ...overrides,
  });

const stripIds = (plan: ScenePlan): unknown =>
  JSON.parse(JSON.stringify(plan, (key, value) => (key === "id" ? "<id>" : value)));

describe("direct — scene segmentation", () => {
  it("produces a seven-scene narrative arc in the canonical order", () => {
    const plan = direct(PROJECT_ID, BRIEF, makeCapture());
    expect(plan.scenes.map((scene) => scene.role)).toEqual([
      "hook",
      "problem",
      "action",
      "outcome",
      "proof",
      "fit",
      "close",
    ]);
    expect(plan.title).toBe("Serendepify launch");
    expect(plan.fps).toBe(60);
    expect(plan.width).toBe(1920);
    expect(plan.height).toBe(1080);
  });

  it("pads short captures to a minimum 24-second beat", () => {
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({durationMs: 8_000}));
    const beat = Math.floor(24_000 / 7);
    expect(beat).toBe(3428);
    expect(plan.scenes[0].startMs).toBe(0);
    expect(plan.scenes[1].startMs).toBe(beat);
    expect(plan.scenes[6].startMs).toBe(6 * beat);
    expect(plan.scenes[6].durationMs).toBe(beat);
  });

  it("spreads long captures across a seven-beat timeline", () => {
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({durationMs: 70_000}));
    expect(plan.scenes[0].durationMs).toBe(10_000);
    expect(plan.scenes[6].source).toEqual({fromMs: 60_000, toMs: 70_000});
  });

  it("keeps source windows inside the capture duration", () => {
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({durationMs: 1_000}));
    expect(plan.scenes[0].source).toEqual({fromMs: 0, toMs: 1_000});
    expect(plan.scenes[1].source).toEqual({fromMs: 999, toMs: 1_000});
    expect(plan.scenes[6].source).toEqual({fromMs: 999, toMs: 1_000});
  });

  it("segments a scroll-only capture into a full arc with no event anchors", () => {
    const events = [scroll(SCROLL_A_ID, 1_000), scroll(SCROLL_B_ID, 2_000)];
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({}, events));
    expect(plan.scenes).toHaveLength(7);
    expect(plan.scenes[2].focusEventIds).toEqual([]);
    expect(plan.scenes[3].focusEventIds).toEqual([]);
    expect(plan.scenes[4].focusEventIds).toEqual([]);
    expect(plan.scenes[2].camera.to).toEqual({x: 0, y: 0, scale: 1.7});
  });
});

describe("direct — event anchoring", () => {
  it("anchors the action scene to the first focus or input event with a 1.7 zoom", () => {
    const events = [click(CLICK_A_ID, 5_000, 100, 100), focus(FOCUS_ID, 6_000, 300, 400), input(INPUT_ID, 7_000)];
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({}, events));
    const action = plan.scenes[2];
    expect(action.focusEventIds).toEqual([FOCUS_ID]);
    expect(action.camera.to.scale).toBe(1.7);
    // camera pans so the focus rect centre (400, 430) sits at the viewport centre (960, 540)
    expect(action.camera.to.x).toBe(960 - 400);
    expect(action.camera.to.y).toBe(540 - 430);
  });

  it("picks the earliest focus/input interaction in event order", () => {
    const events = [input(INPUT_ID, 1_000), focus(FOCUS_ID, 2_000, 300, 400)];
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({}, events));
    expect(plan.scenes[2].focusEventIds).toEqual([INPUT_ID]);
  });

  it("anchors outcome and proof scenes to the first and last clicks", () => {
    const events = [
      click(CLICK_A_ID, 2_000, 100, 100),
      scroll(SCROLL_A_ID, 3_000),
      click(CLICK_B_ID, 4_000, 800, 600),
    ];
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({}, events));
    expect(plan.scenes[3].focusEventIds).toEqual([CLICK_A_ID]);
    expect(plan.scenes[3].camera.to.scale).toBe(1.45);
    expect(plan.scenes[4].focusEventIds).toEqual([CLICK_B_ID]);
    expect(plan.scenes[4].camera.to.scale).toBe(1.55);
  });

  it("reuses the single click as both outcome and proof anchor", () => {
    const events = [click(CLICK_A_ID, 2_000, 500, 300)];
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({}, events));
    expect(plan.scenes[3].focusEventIds).toEqual([CLICK_A_ID]);
    expect(plan.scenes[4].focusEventIds).toEqual([CLICK_A_ID]);
  });

  it("pans the camera toward off-center anchor rectangles", () => {
    // rect {x: 0, y: 0, width: 80, height: 40} → centre (40, 20)
    const events = [click(CLICK_A_ID, 1_000, 0, 0)];
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({}, events));
    const outcome = plan.scenes[3];
    expect(outcome.camera.to.x).toBe(960 - 40);
    expect(outcome.camera.to.y).toBe(540 - 20);
    expect(outcome.camera.from).toEqual({x: 0, y: 0, scale: 1});
  });

  it("centres the camera on the viewport when an anchored event has no rect", () => {
    const events = [{id: CLICK_A_ID, atMs: 1_000, kind: "click", button: 0} as CaptureEvent];
    const plan = direct(PROJECT_ID, BRIEF, makeCapture({}, events));
    expect(plan.scenes[3].focusEventIds).toEqual([CLICK_A_ID]);
    expect(plan.scenes[3].camera.to).toEqual({x: 0, y: 0, scale: 1.45});
  });
});

describe("direct — direction rules", () => {
  it("writes the narrative script into headlines and support lines", () => {
    const plan = direct(PROJECT_ID, BRIEF, makeCapture());
    expect(plan.scenes[0].headline).toBe("Ship with less busywork");
    expect(plan.scenes[1].headline).toBe(BRIEF.customerProblem);
    expect(plan.scenes[1].support).toBe("For founders");
    expect(plan.scenes[5].headline).toBe("Built for founders.");
    expect(plan.scenes[6].headline).toBe("Ship with less busywork");
    expect(plan.scenes[6].support).toBe("Serendepify");
  });

  it("uses the cut/match/mask transition pattern", () => {
    const plan = direct(PROJECT_ID, BRIEF, makeCapture());
    expect(plan.scenes.map((scene) => scene.transition)).toEqual([
      "cut",
      "mask",
      "mask",
      "match",
      "mask",
      "mask",
      "match",
    ]);
  });

  it("carries the brand palette into the plan", () => {
    const plan = direct(PROJECT_ID, BRIEF, makeCapture());
    expect(plan.brand).toEqual(BRIEF.brand);
  });

  it("composes deterministically — same input, same plan apart from ids", () => {
    const first = direct(PROJECT_ID, BRIEF, makeCapture());
    const second = direct(PROJECT_ID, BRIEF, makeCapture());
    expect(stripIds(first)).toEqual(stripIds(second));
  });

  it("round-trips through the scene-plan contract", () => {
    const plan = direct(PROJECT_ID, BRIEF, makeCapture());
    expect(() => scenePlanSchema.parse(plan)).not.toThrow();
  });
});
