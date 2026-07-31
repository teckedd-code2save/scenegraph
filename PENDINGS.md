# SceneGraph — Known Sharp Edges & Gotchas

> Constraints, failure modes, and architectural decisions that are easy to violate. Read this before changing SceneGraph.

## Architecture & Maturity

1. **The browser-only canvas renderer is legacy.** The README states it explicitly: the earlier canvas renderer "is not treated as the final architecture." Server-side Remotion/FFmpeg rendering through `render-worker` is the target — do not resurrect or optimize the canvas path.

2. **Production persistence does not exist yet.** Durable object/database storage, authentication, and production deployment are listed as in progress. Do not assume projects survive a restart beyond the current filesystem persistence.

3. **`apps/studio` declares no dependencies at its package.json root.** Before extending it, confirm the actual runtime framework and dependencies — the manifest may be incomplete or mid-migration.

4. **Redis is a hard runtime dependency.** The render queue (BullMQ) needs Redis via `docker compose up -d`. The director and render-worker will fail to enqueue/process jobs without it.

5. **Node 22 and pnpm 10.14 are pinned in CI.** Use `corepack enable` locally so the pinned package manager matches `validate.yml` (`pnpm/action-setup` version 10.14.0).

## Capture & Recorder

6. **Recorder setup is manual.** The extension is loaded unpacked and requires the project ID to be pasted into its popup — there is no one-click pairing flow yet. Debug flows must replicate this manually.

7. **Clean-tab recording is a requirement, not a nicety.** Captures must exclude browser chrome. If a capture regresses to include the browser UI, treat it as a bug.

8. **Sensitive-field masking is mandatory.** The recorder masks sensitive inputs during capture. Never remove or weaken this — captured walkthroughs can contain real credentials.

9. **Interaction metadata is DOM-anchored.** Clicks, input, focus, scroll, and navigation are anchored to DOM elements. Page changes that move or remove anchors (timing, dynamic content, fonts) can silently degrade the editability of a capture.

## Contracts & Direction

10. **`packages/contracts` is the single source of truth.** Capture, scene-plan, and render-job schemas are validated with Zod there. Bypassing contracts (passing loose objects between services) breaks the pipeline's guarantees.

11. **Director output must be deterministic.** Scene and camera planning should produce the same plan for the same input. Any randomness breaks reproducibility of rendered films.

12. **The renderer must not relabel source recordings.** It deliberately creates separate editorial frames and reframes product moments — it does not claim the source recording is a generated film. Preserve this distinction in any renderer changes.

## CI & Tooling

13. **CI runs typecheck + build only.** `validate.yml` has no test job yet. Do not rely on CI to catch behavioral regressions — run the workspace tests locally.

14. **`--frozen-lockfile` in CI.** Adding a dependency without committing the lockfile update breaks CI. Always run `pnpm install` and commit `pnpm-lock.yaml` together.

15. **Workspace script ordering matters.** CI builds `@scenegraph/contracts` before the workspace-wide typecheck/build because downstream packages import it. New packages that depend on contracts must be added to that ordering.
