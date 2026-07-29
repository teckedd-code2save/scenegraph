# SceneGraph

SceneGraph turns real product walkthroughs into directed launch films.

This repository is the production rebuild of the original visual prototype. It is intentionally organized around clean product capture, structured interaction events, narrative direction, deterministic composition, and server-side Remotion/FFmpeg rendering.

## Product contract

A user supplies a product brief and records one authentic journey. SceneGraph returns a reviewable, editable and downloadable launch film rather than a relabelled screen recording.

## Planned workspace

- `apps/studio` — projects, briefs, scripts, scene plans, previews and voice direction
- `apps/recorder-extension` — clean viewport capture and DOM-anchored interaction events
- `services/director` — marketing narrative and shot planning
- `services/render-worker` — Remotion, Chromium and FFmpeg rendering
- `packages/contracts` — versioned capture, scene-plan and render-job schemas

## Definition of done

- clean capture without browser chrome
- precise clicks, typing, scrolling and focus metadata
- product-specific marketing script and scene plan
- editable camera, text, cursor and transition direction
- deterministic server render
- H.264 MP4 output with web-optimized metadata
- persistent projects and versioned outputs

The earlier browser-only canvas renderer is not treated as the final architecture.