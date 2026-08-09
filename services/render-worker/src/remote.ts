import {readFile} from "node:fs/promises";
import {renderJobSchema} from "@scenegraph/contracts";
import {publishRender, renderFilm} from "./render.js";

const payload = process.argv[2]
  ? await readFile(process.argv[2], "utf8")
  : await new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      process.stdin.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
      process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      process.stdin.on("error", reject);
    });

const job = renderJobSchema.parse(JSON.parse(payload));
const outputLocation = await renderFilm(job);
console.log(JSON.stringify(await publishRender(job, outputLocation)));
