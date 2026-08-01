# Deploy SceneGraph with GroundControl

SceneGraph is packaged as one Docker Compose application. GroundControl should expose only the `gateway` service on port `8080`; every other service remains private.

## Stack boundary

| Service | Network role | Persistent state |
|---|---|---|
| `gateway` | Public HTTP entrypoint | None |
| `studio` | Private product workspace UI | None |
| `director` | Private planning, upload and status API | Projects, captures and rendered-film volume |
| `render-worker` | Private Remotion/Chromium/FFmpeg worker | Shared rendered-film volume |
| `redis` | Private BullMQ queue | Append-only Redis volume |

## GroundControl configuration

1. Create a deployment from `teckedd-code2save/scenegraph` using `docker-compose.yml` at the repository root.
2. Set the public service to `gateway` and its container port to `8080`.
3. Add the domain `scenegraph.serendepify.com` and enable HTTPS.
4. Add these environment secrets:

   - `SCENEGRAPH_PUBLIC_URL=https://scenegraph.serendepify.com`
   - `SCENEGRAPH_ACCESS_TOKEN=<64-character random token>`
   - `SCENEGRAPH_PORT=8080`

5. Deploy the complete Compose application. Do not expose Director, Redis or the worker as separate public services.

Generate the access token outside the application and store it only in GroundControl secrets:

```bash
openssl rand -hex 32
```

## Resource floor

- 4 vCPU
- 8 GB RAM
- 30 GB available disk
- one render-worker replica

The worker is intentionally limited to one job at a time. Increase concurrency only after observing memory during real 1080p renders.

## Verification

After GroundControl reports the stack healthy:

```bash
curl -fsS https://scenegraph.serendepify.com/healthz
curl -fsS https://scenegraph.serendepify.com/health
```

Expected services are `scenegraph-gateway` and `scenegraph-studio`. Director is verified through the gateway by creating a workspace with the access token.

Then:

1. Open `https://scenegraph.serendepify.com`.
2. Enter the same deployment token in **Deployment access token**.
3. Create a product workspace.
4. Build and reload the unpacked extension.
5. Set its Studio API to `https://scenegraph.serendepify.com`, enter the same access token and paste the project ID.
6. Record and upload one clean product journey.
7. Refresh the workspace and generate the first cut.
8. Verify the render reaches `completed`, plays in the browser and downloads as an MP4.

## Persistence and backup

The `scenegraph-data` volume contains project JSON, source captures and rendered films. The `scenegraph-redis` volume contains queued and completed job metadata. Configure GroundControl/VPS backups for both volumes before treating the deployment as durable.

## Rollback

Use GroundControl to redeploy the previous known-good repository commit. Do not delete either named volume during rollback. After rollback, verify `/healthz`, create no new work until Director and Redis are healthy, and replay an existing rendered-film URL from its workspace.

## Maturity

This deployment is **early access for one trusted operator**. The access token and signed assets prevent anonymous use, but multi-user accounts, quotas, database replication and external object storage are not yet implemented.
