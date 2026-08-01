import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {extname, join, normalize} from "node:path";
import {fileURLToPath} from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const types = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8"};
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url ?? "/", "http://local").pathname;
  if (pathname === "/health") {
    response.writeHead(200, {"content-type": "application/json", "cache-control": "no-store"});
    response.end(JSON.stringify({ok: true, service: "scenegraph-studio"}));
    return;
  }
  if (pathname === "/config.js") {
    response.writeHead(200, {"content-type": "text/javascript; charset=utf-8", "cache-control": "no-store"});
    response.end(`globalThis.SCENEGRAPH_API=${JSON.stringify(process.env.SCENEGRAPH_API_URL ?? "http://localhost:4100")};`);
    return;
  }
  const relative = pathname === "/" ? "index.html" : normalize(pathname).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]/, "");
  try {
    const body = await readFile(join(root, relative));
    response.writeHead(200, {"content-type": types[extname(relative)] ?? "application/octet-stream"});
    response.end(body);
  } catch {
    response.writeHead(404, {"content-type": "text/plain"}); response.end("Not found");
  }
});
const port = Number(process.env.STUDIO_PORT ?? 3000);
server.listen(port, "0.0.0.0", () => console.log(`SceneGraph Studio http://localhost:${port}`));
