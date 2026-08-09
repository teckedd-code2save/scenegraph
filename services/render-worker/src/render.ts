import path from "node:path";
import {createReadStream} from "node:fs";
import {mkdir, unlink} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {bundle} from "@remotion/bundler";
import {getCompositions, renderMedia} from "@remotion/renderer";
import {renderResultSchema, type RenderJob, type RenderResult} from "@scenegraph/contracts";
import {createObjectStoreFromEnv} from "@scenegraph/media-store";

let serveUrl: string | null = null;
const megabytes = (value: number) => value * 1024 * 1024;
const workerRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const renderFilm = async (job: RenderJob) => {
  const outputDir = path.resolve(process.env.RENDER_OUTPUT_DIR ?? "./renders");
  const browserExecutable = process.env.REMOTION_BROWSER_EXECUTABLE ?? process.env.CHROME_PATH;
  await mkdir(outputDir, {recursive: true});
  serveUrl ??= await bundle({entryPoint: path.join(workerRoot, "src", "remotion", "index.ts")});
  const inputProps = {job};
  const composition = (await getCompositions(serveUrl, {inputProps, browserExecutable}))
    .find((item) => item.id === "LaunchFilm");
  if (!composition) throw new Error("LaunchFilm composition missing");
  const outputLocation = path.join(outputDir, `${job.id}-${job.output.profile}.mp4`);
  await renderMedia({
    composition,
    serveUrl,
    inputProps,
    outputLocation,
    browserExecutable,
    codec: "h264",
    audioCodec: "aac",
    pixelFormat: "yuv420p",
    concurrency: 1,
    disallowParallelEncoding: true,
    mediaCacheSizeInBytes: megabytes(Number(process.env.REMOTION_MEDIA_CACHE_MB ?? 128)),
    offthreadVideoCacheSizeInBytes: megabytes(Number(process.env.REMOTION_VIDEO_CACHE_MB ?? 128)),
    offthreadVideoThreads: 1,
  });
  return outputLocation;
};

export const publishRender = async (job: RenderJob, outputLocation: string): Promise<RenderResult> => {
  const objectStore = createObjectStoreFromEnv();
  if (!objectStore) return renderResultSchema.parse({profile: job.output.profile, outputLocation});
  const outputKey = `renders/${job.projectId}/${job.id}-${job.output.profile}.mp4`;
  await objectStore.put(outputKey, createReadStream(outputLocation), "video/mp4");
  await unlink(outputLocation).catch(() => undefined);
  return renderResultSchema.parse({profile: job.output.profile, outputKey});
};
