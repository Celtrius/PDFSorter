import { mkdir, copyFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const target = path.join(root, "public/ocr");
await mkdir(path.join(target, "core"), { recursive: true });
await mkdir(path.join(target, "lang"), { recursive: true });
await copyFile(
  path.join(root, "node_modules/tesseract.js/dist/worker.min.js"),
  path.join(target, "worker.min.js"),
);
for (const name of await readdir(
  path.join(root, "node_modules/tesseract.js-core"),
)) {
  if (name.endsWith(".wasm") || name.endsWith(".wasm.js"))
    await copyFile(
      path.join(root, "node_modules/tesseract.js-core", name),
      path.join(target, "core", name),
    );
}
await copyFile(
  path.join(
    root,
    "node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz",
  ),
  path.join(target, "lang/eng.traineddata.gz"),
);
console.log("Local OCR worker, WASM cores, and language data ready.");
