import { readFile, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
const model = new URL("../public/models/kyoto/kyoto_city_lod1.glb", import.meta.url);
const raw = await readFile(model);
const compressed = gzipSync(raw, { level: 6 });
await writeFile(new URL(`${model.href}.gz`), compressed);
console.log(`Kyoto download: ${raw.length} → ${compressed.length} bytes (lossless gzip)`);
