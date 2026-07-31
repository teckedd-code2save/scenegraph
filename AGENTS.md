# SceneGraph — Agent Guide

> Turn real product walkthroughs into directed launch films. Record one authentic journey, get a reviewable, editable, downloadable launch film — powered by Remotion and FFmpeg.

---

## 1. Technology Stack

| Layer | Technology |
|---|---|
| Monorepo | pnpm workspaces (pnpm 10.14) |
| Language | TypeScript (Node 22) |
| Capture | Chrome extension (MV3) |
| Direction service | Fastify + BullMQ (Redis) |
| Rendering | Remotion + FFmpeg (H.264/AAC MP4) |
| Contracts | Zod-validated schemas |

## 2. Workspace Structure

```
scenegraph/
├── apps/
│   ├── studio/                 Fresh product workspaces, capture state, directing
│   │                           timeline, render progress, playback and download
│   └── recorder-extension/     Clean tab video plus DOM-anchored clicks, input,
│                               focus, scroll and navigation metadata
├── services/
│   ├── director/               Product-specific narrative, scene and camera planning
│   └── render-worker/          Queued Remotion rendering to H.264/AAC MP4
├── packages/
│   └── contracts/              Validated capture, scene-plan and render-job schemas
├── docker-compose.yml          Redis for the BullMQ render queue
└── package.json                pnpm workspace root
```

## 3. Key Scripts

| Script | Command | Description |
|---|---|---|
| Dev | `pnpm dev` | Runs studio, director, and render-worker with watch |
| Build | `pnpm build` | Builds all workspaces (`pnpm -r build`) |
| Typecheck | `pnpm typecheck` | TypeScript across all workspaces |
| Lint | `pnpm lint` | Lint across all workspaces |
| Test | `pnpm test` | Tests across all workspaces |

## 4. Development

```bash
corepack enable
pnpm install
pnpm typecheck
pnpm build
docker compose up -d     # Redis for the render queue
pnpm dev
```

Load the unpacked extension from `apps/recorder-extension`, create a project at `http://localhost:3000`, and paste its project ID into the recorder popup.

## 5. Build & Deploy

CI (`validate.yml`) runs on every PR and push to `main`:

1. `pnpm install --frozen-lockfile`
2. Build `@scenegraph/contracts`
3. `pnpm typecheck`
4. `pnpm build`

No production deployment is wired up yet — durable storage, authentication, and production hosting are in progress.

## 6. Code Conventions

- **Contracts-first data flow.** All capture, scene-plan, and render-job data crosses service boundaries as Zod-validated schemas from `packages/contracts`. Never pass ad-hoc object shapes between studio, director, and render-worker.
- **Deterministic composition.** Director output must be reproducible — no randomness in narrative, scene, or camera planning.
- **Server-side rendering is the target.** The render-worker produces the final film (Remotion + FFmpeg). The earlier browser-only canvas renderer is legacy and not treated as the final architecture.
- **Capture stays clean.** Recording must exclude browser chrome and keep precise DOM-anchored interaction metadata. Sensitive-field masking is a hard requirement — do not regress it.
- **Lockfile discipline.** CI installs with `--frozen-lockfile`, so dependency changes must be committed with an updated `pnpm-lock.yaml`.
