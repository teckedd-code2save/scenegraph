# SceneGraph

SceneGraph turns real product walkthroughs into directed launch films.

This repository is the production rebuild of the original visual prototype. It is intentionally organized around clean product capture, structured interaction events, narrative direction, deterministic composition, and server-side Remotion/FFmpeg rendering.

## Product contract

A user supplies a product brief and records one authentic journey. SceneGraph returns a reviewable, editable and downloadable launch film rather than a relabelled screen recording.

## Workspace

- `apps/recorder-extension` — DOM-anchored clicks, input, focus, scroll and navigation metadata
- `services/director` — product-specific narrative, scene and camera planning
- `services/render-worker` — queued Remotion rendering to H.264/AAC MP4
- `packages/contracts` — validated capture, scene-plan and render-job schemas

## Current maturity

- **Live in this branch:** versioned contracts, precise DOM event anchors, sensitive-field masking, deterministic seven-beat planning, camera targeting, editorial cards, subtle click treatment, Redis render queue and server-side H.264 composition.
- **In progress:** tab video stream capture/upload, persistent project storage, rendered-output delivery and the studio workspace.
- **Product direction:** voice-directed revisions and GitHub-triggered feature films.

The renderer deliberately creates separate editorial frames and reframes selected product moments. It does not label the source recording as a generated film.

## Local validation

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm build
docker compose up -d
```

## Definition of done

- clean capture without browser chrome
- precise clicks, typing, scrolling and focus metadata
- product-specific marketing script and scene plan
- editable camera, text, cursor and transition direction
- deterministic server render
- H.264 MP4 output with web-optimized metadata
- persistent projects and versioned outputs

The earlier browser-only canvas renderer is not treated as the final architecture.
