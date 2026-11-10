# Drowsiness tracking diagnostics fix

This update adds visible eye-landmark dots, a more visible live face-tracking status, slightly more permissive heuristic thresholds, and a manual test-alert button.

## Important
- This is an experimental demo, not a certified drowsiness detector.
- Test only while parked.
- The manual alert button checks browser audio/voice/vibration permissions separately from eye detection.
- A `FACE TRACKED` status and moving green dots are required before interpreting eye-closure results.

## If publishing with Netlify
Rebuild the `site-upload` directory after applying these updated `app.js` and `index.html` files. Ensure the MediaPipe import and WASM paths are rewritten to the copied local `mediapipe` directory as in the deployment instructions. Do not deploy the old `site-upload` directory unchanged.
