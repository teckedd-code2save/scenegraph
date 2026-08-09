import json
import os
import re
import subprocess

import modal


image = (
    modal.Image.from_registry(
        "ghcr.io/teckedd-code2save/scenegraph-render-worker:main",
        add_python="3.12",
    )
    .pip_install("fastapi[standard]==0.116.1")
)

app = modal.App("scenegraph-renderer")


@app.function(
    image=image,
    cpu=2.0,
    memory=4096,
    timeout=30 * 60,
    scaledown_window=60,
    secrets=[modal.Secret.from_name("scenegraph-renderer")],
)
@modal.concurrent(max_inputs=1)
@modal.asgi_app()
def renderer_api():
    from fastapi import FastAPI, HTTPException, Request

    web = FastAPI()

    @web.post("/")
    async def render(request: Request):
        expected = os.environ.get("SCENEGRAPH_RENDER_TOKEN", "")
        supplied = request.headers.get("authorization", "").removeprefix("Bearer ")
        if not expected or not supplied or not __import__("hmac").compare_digest(expected, supplied):
            raise HTTPException(status_code=401, detail="Invalid renderer token")

        job = await request.json()
        completed = subprocess.run(
            ["node", "dist/remote.js"],
            cwd="/app/services/render-worker",
            input=json.dumps(job),
            text=True,
            capture_output=True,
            timeout=29 * 60,
            check=False,
        )
        if completed.returncode != 0:
            detail = completed.stderr.strip()[-1200:] or "Renderer exited without an error message"
            detail = re.sub(r"(https?://[^?\s]+)\?[^\s]+", r"\1?<redacted>", detail)
            raise HTTPException(status_code=500, detail=detail)

        lines = [line for line in completed.stdout.splitlines() if line.strip()]
        if not lines:
            raise HTTPException(status_code=500, detail="Renderer returned no result")
        return json.loads(lines[-1])

    return web
