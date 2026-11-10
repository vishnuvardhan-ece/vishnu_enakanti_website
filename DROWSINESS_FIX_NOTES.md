# Drowsiness monitoring update

This update combines MediaPipe eye-blink blendshape scores with a geometric eye-aspect-ratio estimate, displays live diagnostic values, and adds a short audible beep before optional speech/vibration alerts. It is a heuristic prototype only; camera angle, glasses, lighting, and face tracking can affect results.

## Apply
1. Extract this project to a new folder.
2. Open `phone-app` in VS Code terminal.
3. Run `Set-ExecutionPolicy -Scope Process Bypass` then `./setup.ps1` once.
4. Run `python -m http.server 8000` and open `http://localhost:8000`.
5. Select Driver Monitoring, click Start camera, keep face fully visible and well lit. The status line shows blink L/R and eye ratio. Keep eyes closed for over about 1.3 seconds only while safely parked to test.

This is not a certified drowsiness detector and must not be relied on for driving safety.
