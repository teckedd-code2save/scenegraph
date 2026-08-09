# Deploy SceneGraph with GroundControl

SceneGraph's production deployment keeps the small VPS as a control plane. GroundControl runs the gateway, Studio, Director and Redis; Cloudflare R2 stores video; Modal starts Chromium/Remotion only while a film is rendering.

## Production boundary

| Component | Location | Responsibility |
|---|---|---|
| `gateway` | GroundControl VPS | Public HTTP entrypoint on `8080` |
| `studio` | GroundControl VPS | Product workspace UI |
| `director` | GroundControl VPS | Project metadata, directing, uploads and render dispatch |
| `redis` | GroundControl VPS | Bounded BullMQ job state |
| R2 | Cloudflare | Private source captures and rendered films |
| `render-worker` | Modal | On-demand Remotion/Chromium/FFmpeg rendering |

The Compose `render-worker` service is under the `local-renderer` profile. Do not enable that profile on the constrained GroundControl host.

## One-time R2 setup

1. Create a private R2 bucket named `scenegraph-media` (or choose another name).
2. Create an R2 API token scoped to read and write that bucket.
3. Keep the account ID, access key ID and secret access key. They are used by Director and by the Modal renderer.

SceneGraph stores stable object keys in project data and issues short-lived signed URLs only when a capture must be rendered or a film played. The bucket does not need to be public.

## One-time Modal setup

The renderer image is published by `.github/workflows/publish-images.yml` as `ghcr.io/teckedd-code2save/scenegraph-render-worker:main`. Make the package pullable by Modal (public for this public repository, or provide registry credentials in Modal).

Create a Modal secret named `scenegraph-renderer` containing:

- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET`
- `SCENEGRAPH_RENDER_TOKEN` — a separate strong random token

Then deploy `deploy/modal_renderer.py` with the Modal CLI. Keep the resulting HTTPS endpoint; it becomes `MODAL_RENDER_URL` in GroundControl. `SCENEGRAPH_RENDER_TOKEN` and GroundControl's `MODAL_RENDER_TOKEN` must contain the same value.

## GroundControl configuration

Use the **VPS Caddy Existing Compose** template:

1. Source: `teckedd-code2save/scenegraph`.
2. Compose file: `docker-compose.yml`.
3. Public service: `gateway`.
4. Container port: `8080`.
5. Health path: `/healthz`.
6. Domain: `scenegraph.serendepify.com` with HTTPS.

Set these environment values in GroundControl:

- `SCENEGRAPH_PUBLIC_URL=https://scenegraph.serendepify.com`
- `SCENEGRAPH_ACCESS_TOKEN=<strong random token>`
- `SCENEGRAPH_PORT=8080`
- `SCENEGRAPH_IMAGE_TAG=main`
- `R2_ACCOUNT_ID=<Cloudflare account ID>`
- `R2_ACCESS_KEY_ID=<R2 access key ID>`
- `R2_SECRET_ACCESS_KEY=<R2 secret access key>`
- `R2_BUCKET=scenegraph-media`
- `MODAL_RENDER_URL=<deployed Modal endpoint>`
- `MODAL_RENDER_TOKEN=<same value as Modal SCENEGRAPH_RENDER_TOKEN>`

Only `gateway` is public. Director and Redis stay on the private Compose network.

## Resource profile

The default production services are capped at roughly 736 MB in aggregate:

- gateway: 64 MB / 0.15 CPU
- Studio: 96 MB / 0.20 CPU
- Director: 384 MB / 0.50 CPU
- Redis: 192 MB / 0.25 CPU, with a 128 MB data cap

A 2-core, 2 GB VPS is a reasonable early-access floor for SceneGraph itself. Media and Chromium rendering no longer consume the VPS disk or multi-gigabyte render memory. Existing workloads on the host still need their own headroom.

## Verification

After deployment:

```bash
curl -fsS https://scenegraph.serendepify.com/healthz
curl -fsS https://scenegraph.serendepify.com/health
```

Director health should report `media: "r2"` and `renderer: "modal"`.

Then perform the product path:

1. Open `https://scenegraph.serendepify.com` and enter the deployment access token.
2. Create a fresh product workspace.
3. Set the recorder extension API to the same SceneGraph URL, access token and project ID.
4. Record one clean product tab and stop/upload it.
5. Refresh the workspace and generate the 720p30 preview.
6. Confirm the directed preview plays, then choose **Render 1080p master**.
7. Confirm the 1080p60 master plays and downloads.

The preview and master are separate render jobs from the same directed plan. The master is not a renamed preview or source recording.

## Local fallback

Local development can keep using Redis plus `pnpm dev`. To exercise the Dockerized heavyweight worker intentionally, use the `local-renderer` Compose profile together with `docker-compose.build.yml`; do not use that profile on the small production VPS.

## Persistence and rollback

R2 owns captures and films. `scenegraph-data` still contains project JSON and must be backed up until database persistence lands. `scenegraph-redis` contains bounded queue state.

Rollback by redeploying the previous known-good image/repository revision in GroundControl. Do not delete either named volume or the R2 bucket. A rollback of the control plane does not destroy source captures or completed masters.

## Maturity

This is **early access for one trusted operator**. R2 media storage, remote rendering, preview/master outputs and signed assets are implemented. Multi-user identity, database persistence, automatic R2 lifecycle policies, voice revisions and GitHub-triggered films remain in progress or product direction as documented in the repository.
