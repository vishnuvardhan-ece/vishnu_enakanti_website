# Fix for networks that block MediaPipe CDNs

This version loads MediaPipe, WASM, and the face model from local files rather than a browser CDN.

1. Open a PowerShell terminal in this `phone-app` folder.
2. Run: `Set-ExecutionPolicy -Scope Process Bypass` (if PowerShell blocks the script).
3. Run: `./setup.ps1`
4. After setup completes, run: `python -m http.server 8000`
5. Open `http://localhost:8000` and hard-refresh with Ctrl+F5.

The setup downloads the npm package from `registry.npmjs.org` and the face model from Google Storage. If those domains are also blocked, this setup will print the exact download failure; use an unrestricted network or download the package/model elsewhere and copy them into this folder. The app is a prototype, not a certified driving safety system.
