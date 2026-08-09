import {readFile, writeFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const contentPath = join(root, "dist", "content.js");
const source = await readFile(contentPath, "utf8");
await writeFile(contentPath, source.replace(/\nexport \{\};(?=\n\/\/# sourceMappingURL=content\.js\.map\s*$)/, ""));
