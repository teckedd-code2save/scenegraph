import {Worker} from "bullmq";
import {renderJobSchema} from "@scenegraph/contracts";
import {publishRender, renderFilm} from "./render.js";

const redisUrl = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
const worker = new Worker("scenegraph-renders", async (queued) => {
  const job = renderJobSchema.parse(queued.data);
  const outputLocation = await renderFilm(job);
  return publishRender(job, outputLocation);
}, {connection: {host: redisUrl.hostname, port: Number(redisUrl.port || 6379)}, concurrency: 1});

worker.on("completed", (job, result) => console.log(JSON.stringify({event: "render.completed", jobId: job.id, ...result})));
worker.on("failed", (job, error) => console.error(JSON.stringify({event: "render.failed", jobId: job?.id, error: error.message})));
