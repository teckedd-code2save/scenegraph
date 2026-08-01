import path from "node:path";
import {mkdir} from "node:fs/promises";
import {bundle} from "@remotion/bundler";
import {getCompositions, renderMedia} from "@remotion/renderer";
import {Worker} from "bullmq";
import {renderJobSchema, type RenderJob} from "@scenegraph/contracts";

let serveUrl: string | null = null;
const render = async (job: RenderJob) => {
  const outputDir = path.resolve(process.env.RENDER_OUTPUT_DIR ?? "./renders");
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE ?? process.env.CHROME_PATH;
  await mkdir(outputDir, {recursive: true});
  serveUrl ??= await bundle({entryPoint: path.resolve("src/remotion/index.ts")});
  const inputProps = {job};
  const composition = (await getCompositions(serveUrl, {inputProps, browserExecutable})).find((item) => item.id === "LaunchFilm");
  if (!composition) throw new Error("LaunchFilm composition missing");
  const outputLocation = path.join(outputDir, `${job.id}.mp4`);
  await renderMedia({
    composition, serveUrl, inputProps, outputLocation,
    browserExecutable,
    codec: "h264", audioCodec: "aac", pixelFormat: "yuv420p",
  });
  return outputLocation;
};

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const worker = new Worker("scenegraph-renders", async (queued) => {
  const job = renderJobSchema.parse(queued.data);
  return {outputLocation: await render(job)};
}, {connection: {host: redisUrl.hostname, port: Number(redisUrl.port || 6379)}, concurrency: 1});

worker.on("completed", (job, result) => console.log(JSON.stringify({event: "render.completed", jobId: job.id, ...result})));
worker.on("failed", (job, error) => console.error(JSON.stringify({event: "render.failed", jobId: job?.id, error: error.message})));
