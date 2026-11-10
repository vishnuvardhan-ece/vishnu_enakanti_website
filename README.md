# AI Driver Safety — Vercel deployment

## Fix for MediaPipe import failures on Vercel

The browser must not import MediaPipe from `/node_modules`. Vercel does not expose the repository's installed dependencies as public static files. This project therefore builds a deployable `dist/` folder:

- `/vendor/mediapipe/vision_bundle.mjs`
- `/vendor/mediapipe/wasm/`
- `/models/face_landmarker.task`

The build copies the MediaPipe bundle and WASM runtime from the pinned npm dependency and copies or downloads the Face Landmarker model. Both the normal driver-monitoring mode and the parallel-camera mode use these same public paths.

## Local Windows setup

From the repository root in PowerShell:

```powershell
npm.cmd install
npm.cmd run build
npx.cmd --yes http-server .\dist -p 8000
```

Open `http://localhost:8000`. Keep the server running.

## Vercel settings

The included `vercel.json` configures:

- Build command: `npm run build`
- Output directory: `dist`

Set the Vercel project Root Directory to the repository root (the folder containing `package.json` and `vercel.json`). Redeploy after merging this fix.

## Notes

Camera and geolocation access require HTTPS in production (localhost is a browser secure-context exception). COCO-SSD's TensorFlow.js scripts remain loaded from their existing CDN URLs. Public route/geocoding services require internet access. This is an experimental prototype, not a certified driving-safety system.
