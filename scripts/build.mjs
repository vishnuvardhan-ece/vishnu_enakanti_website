import { access, copyFile, cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const modelUrl = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task";

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function copyRequired(source, destination) {
  if (!(await exists(source))) {
    throw new Error("Required build input is missing: " + path.relative(root, source));
  }
  await copyFile(source, destination);
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

// Copy the static web application to Vercel's output directory.
for (const file of ["index.html", "style.css", "app.js", "ar-navigation.js", "parallel-mode.js"]) {
  await copyRequired(path.join(root, file), path.join(dist, file));
}

// Vercel does not publish node_modules as public static files. Copy the
// MediaPipe browser bundle and its WASM runtime into an explicit public path.
const mpPackage = path.join(root, "node_modules", "@mediapipe", "tasks-vision");
const mpBundle = path.join(mpPackage, "vision_bundle.mjs");
const wasmSource = path.join(mpPackage, "wasm");
const mpPublic = path.join(dist, "vendor", "mediapipe");
await mkdir(mpPublic, { recursive: true });
await copyRequired(mpBundle, path.join(mpPublic, "vision_bundle.mjs"));
if (!(await exists(wasmSource))) {
  throw new Error("MediaPipe WASM assets are missing. Run npm install before building.");
}
await cp(wasmSource, path.join(mpPublic, "wasm"), { recursive: true });

// Copy the face model if it is available locally; otherwise fetch it during
// the Vercel build so the deployed browser never requests it from node_modules.
const modelSource = path.join(root, "models", "face_landmarker.task");
const modelPublicDir = path.join(dist, "models");
const modelPublic = path.join(modelPublicDir, "face_landmarker.task");
await mkdir(modelPublicDir, { recursive: true });
if (await exists(modelSource)) {
  await copyFile(modelSource, modelPublic);
} else {
  console.log("Downloading Face Landmarker model for deployment…");
  const response = await fetch(modelUrl);
  if (!response.ok) {
    throw new Error("Could not download the Face Landmarker model (HTTP " + response.status + "). Check build network access.");
  }
  await writeFile(modelPublic, new Uint8Array(await response.arrayBuffer()));
}

console.log("Build complete: MediaPipe bundle, WASM files, and face model are published from /vendor/mediapipe and /models.");
