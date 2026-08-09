# SceneGraph

SceneGraph turns real product walkthroughs into directed launch films.

This repository is the production rebuild of the original visual prototype. It is intentionally organized around clean product capture, structured interaction events, narrative direction, deterministic composition, and server-side Remotion/FFmpeg rendering.

## Product contract

A user supplies a product brief and records one authentic journey. SceneGraph returns a reviewable, editable and downloadable launch film rather than a relabelled screen recording.

## Workspace

- `apps/studio` — fresh product workspaces, capture state, directing timeline, render progress, playback and download
- `apps/recorder-extension` — clean tab video plus DOM-anchored clicks, input, focus, scroll and navigation metadata
- `services/director` — product-specific narrative, scene and camera planning
- `services/render-worker` — memory-bounded Remotion rendering on Modal, with a local worker fallback
- `packages/contracts` — validated capture, scene-plan and render-job schemas
- `packages/media-store` — private Cloudflare R2 media storage and short-lived signed asset URLs

## Current maturity

- **Early access:** fresh workspaces, token-protected clean tab capture, exact DOM anchors, sensitive-field masking, private R2 media, short-lived asset URLs, deterministic seven-beat planning, camera targeting, editorial cards, subtle click treatment, Redis render queue, on-demand Modal rendering, 720p previews, 1080p60 masters, playback and download.
- **In progress:** multi-user identity, database persistence, media lifecycle automation and recorded voice revisions.
- **Product direction:** GitHub-triggered feature films.

The renderer deliberately creates separate editorial frames and reframes selected product moments. It does not label the source recording as a generated film.

## Local validation

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm build
docker compose up redis -d
pnpm dev
```

Load the unpacked extension from `apps/recorder-extension`, create a project at `http://localhost:3000`, and paste its project ID into the recorder popup.

## GroundControl deployment

SceneGraph ships a lean GroundControl control plane with one public gateway and private Studio, Director and Redis services. Captures and films live in R2; Modal starts the Chromium renderer only for active jobs. See [docs/GROUNDCONTROL.md](docs/GROUNDCONTROL.md) for deployment, verification and rollback.

## Definition of done

- clean capture without browser chrome
- precise clicks, typing, scrolling and focus metadata
- product-specific marketing script and scene plan
- editable camera, text, cursor and transition direction
- economical 720p review render and deterministic 1080p60 master
- H.264 MP4 output with web-optimized metadata
- persistent projects and versioned outputs

The earlier browser-only canvas renderer is not treated as the final architecture.
