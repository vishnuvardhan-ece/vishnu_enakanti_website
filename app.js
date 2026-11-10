let FaceLandmarker = null;
let FilesetResolver = null;

const $ = (id) => document.getElementById(id);
const video = $("video");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");

let mode = "road";
let stream = null;
let stopped = true;
let busy = false;
let cocoModel = null;
let faceLandmarker = null;
let gpsWatch = null;
let lastAlertAt = 0;
let eyeClosedSince = null;
let yawningSince = null;
let lastDriverState = "Not monitored";
let currentPredictions = [];
let animationId = null;
let audioContext = null;

const roadClasses = new Set([
  "person", "bicycle", "car", "motorcycle", "bus", "truck",
  "traffic light", "stop sign"
]);

function logEvent(message) {
  const list = $("eventLog");
  if (list.children.length === 1 && list.firstElementChild.textContent === "No events yet.") list.innerHTML = "";
  const li = document.createElement("li");
  li.textContent = `${new Date().toLocaleTimeString()} — ${message}`;
  list.prepend(li);
  while (list.children.length > 30) list.lastElementChild.remove();
}

function alertUser(message, force = false) {
  const now = Date.now();
  if (!force && now - lastAlertAt < 6000) return;
  lastAlertAt = now;
  logEvent(message);
  // Audible beep works even when speech voices are unavailable. AudioContext is
  // created from the Start-camera user gesture to satisfy browser autoplay rules.
  try {
    if (audioContext && audioContext.state === "suspended") audioContext.resume();
    if (audioContext) {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audioContext.currentTime);
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.22, audioContext.currentTime + 0.025);
      gain.gain.setValueAtTime(0.22, audioContext.currentTime + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.24);
      oscillator.connect(gain); gain.connect(audioContext.destination);
      oscillator.start(); oscillator.stop(audioContext.currentTime + 0.25);
    }
  } catch (e) { console.warn("Beep alert unavailable", e); }
  if ($("voiceToggle").checked && "speechSynthesis" in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(message);
      utterance.volume = 1; utterance.rate = 0.95;
      window.speechSynthesis.speak(utterance);
    } catch (e) { console.warn("Speech alert unavailable", e); }
  }
  if ($("vibrateToggle").checked && "vibrate" in navigator) navigator.vibrate([250, 120, 250, 120, 350]);
}

async function loadCoco() {
  if (cocoModel) return cocoModel;
  $("cameraStatus").textContent = "Loading COCO-SSD model…";
  cocoModel = await cocoSsd.load({ base: "lite_mobilenet_v2" });
  return cocoModel;
}

async function loadFaceLandmarker() {
  if (faceLandmarker) return faceLandmarker;
  $("cameraStatus").textContent = "Loading face-landmark library…";
  // Load MediaPipe from this project folder, not from a browser CDN.
  // Run setup.ps1 once to install the package and download the face model.
  try {
    const mp = await import("./vendor/mediapipe/vision_bundle.mjs");
    FaceLandmarker = mp.FaceLandmarker;
    FilesetResolver = mp.FilesetResolver;
    if (!FaceLandmarker || !FilesetResolver) {
      throw new Error("MediaPipe exports were not found. Run .\setup.ps1 inside phone-app.");
    }
  } catch (error) {
    throw new Error(`Could not load local MediaPipe files: ${error.message}. In the phone-app terminal, run .\setup.ps1 and retry.`);
  }
  $("cameraStatus").textContent = "Loading face-landmark model…";
  const vision = await FilesetResolver.forVisionTasks(
    "./vendor/mediapipe/wasm"
  );
  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "./models/face_landmarker.task",
      delegate: "CPU"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: true
  });
  return faceLandmarker;
}

function resizeCanvas() {
  if (!video.videoWidth || !video.videoHeight) return;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
}

async function stopCamera() {
  stopped = true;
  if (animationId) cancelAnimationFrame(animationId);
  animationId = null;
  if (stream) stream.getTracks().forEach(track => track.stop());
  stream = null;
  video.srcObject = null;
  currentPredictions = [];
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  $("startBtn").disabled = false;
  $("stopBtn").disabled = true;
  $("emptyState").style.display = "grid";
  $("cameraStatus").textContent = "Camera is stopped.";
  $("objectCount").textContent = "—";
  $("driverState").textContent = "Not monitored";
  eyeClosedSince = null;
  yawningSince = null;
  lastDriverState = "Not monitored";
}

async function startCamera() {
  await stopCamera();
  $("startBtn").disabled = true;
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera API unavailable. Use HTTPS or localhost in a supported browser.");
    }
    // Unlock audio during the Start-camera click; browsers may block later audio otherwise.
    try { audioContext = audioContext || new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume(); } catch (e) { console.warn("Audio unavailable", e); }
    if (mode === "road") await loadCoco();
    else await loadFaceLandmarker();

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: mode === "road" ? { ideal: "environment" } : { ideal: "user" },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      }
    });
    video.srcObject = stream;
    await video.play();
    resizeCanvas();
    stopped = false;
    $("stopBtn").disabled = false;
    $("emptyState").style.display = "none";
    $("cameraStatus").textContent = mode === "road"
      ? "Road camera active. Detection is a prototype and does not measure distance."
      : "Driver camera active. Fatigue estimate is heuristic and may be wrong.";
    logEvent(`${mode === "road" ? "Road detection" : "Driver monitoring"} started.`);
    animationId = requestAnimationFrame(processFrame);
  } catch (error) {
    $("cameraStatus").textContent = `Could not start: ${error.message}`;
    $("startBtn").disabled = false;
    $("stopBtn").disabled = true;
    logEvent(`Camera/model error: ${error.message}`);
  }
}

function drawBox(box, label, score) {
  const [x, y, width, height] = box;
  ctx.strokeStyle = "#38bdf8";
  ctx.lineWidth = Math.max(2, canvas.width / 400);
  ctx.strokeRect(x, y, width, height);
  const text = `${label} ${(score * 100).toFixed(0)}%`;
  ctx.font = `${Math.max(14, canvas.width / 55)}px system-ui`;
  const textWidth = ctx.measureText(text).width;
  ctx.fillStyle = "#075985";
  ctx.fillRect(x, Math.max(0, y - 28), textWidth + 12, 26);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + 6, Math.max(19, y - 9));
}

function blendshapeScore(categories, name) {
  const item = categories?.find(category => category.categoryName === name);
  return item?.score ?? 0;
}

function pointDistance(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function eyeAspectRatio(landmarks, ids) {
  const [outer, upper1, upper2, inner, lower2, lower1] = ids.map(i => landmarks?.[i]);
  if (![outer, upper1, upper2, inner, lower2, lower1].every(Boolean)) return null;
  const horizontal = pointDistance(outer, inner);
  if (horizontal < 0.0001) return null;
  return (pointDistance(upper1, lower1) + pointDistance(upper2, lower2)) / (2 * horizontal);
}

function processDriverResult(result) {
  const face = result.faceBlendshapes?.[0]?.categories;
  const landmarks = result.faceLandmarks?.[0];
  if (!landmarks) {
    $("driverState").textContent = "Face not detected — face camera directly";
    $("cameraStatus").textContent = "Driver camera active, but no face landmarks found. Improve lighting and face the camera.";
    eyeClosedSince = null;
    yawningSince = null;
    return;
  }

  const leftBlink = blendshapeScore(face, "eyeBlinkLeft");
  const rightBlink = blendshapeScore(face, "eyeBlinkRight");
  const blinkScore = (leftBlink + rightBlink) / 2;
  const leftEar = eyeAspectRatio(landmarks, [33, 160, 158, 133, 153, 144]);
  const rightEar = eyeAspectRatio(landmarks, [362, 385, 387, 263, 373, 380]);
  const earValues = [leftEar, rightEar].filter(Number.isFinite);
  const ear = earValues.length ? earValues.reduce((a, b) => a + b, 0) / earValues.length : null;
  // Blendshape confidence and geometric eye openness are combined to avoid
  // relying on a single model signal. Thresholds are heuristic and need calibration.
  const eyesClosed = blinkScore > 0.42 || (ear !== null && ear < 0.22);
  const jawOpen = blendshapeScore(face, "jawOpen") > 0.65;
  const now = performance.now();

  if (eyesClosed) {
    if (eyeClosedSince === null) eyeClosedSince = now;
  } else {
    eyeClosedSince = null;
  }
  if (jawOpen) {
    if (yawningSince === null) yawningSince = now;
  } else {
    yawningSince = null;
  }

  const prolongedClosure = eyeClosedSince !== null && now - eyeClosedSince > 1200;
  const prolongedMouthOpen = yawningSince !== null && now - yawningSince > 1200;
  let state = "Eyes open (estimate)";
  if (prolongedClosure) state = "WARNING: eyes closed too long";
  else if (prolongedMouthOpen) state = "Possible yawn";
  else if (eyesClosed) state = "Eyes closed — timing";

  $("driverState").textContent = state;
  const earText = ear === null ? "n/a" : ear.toFixed(3);
  // Draw a few facial landmarks so the user can verify that tracking is active.
  ctx.fillStyle = "#22c55e";
  for (const idx of [33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380]) {
    const pt = landmarks[idx];
    if (pt) {
      ctx.beginPath();
      ctx.arc(pt.x * canvas.width, pt.y * canvas.height, Math.max(2, canvas.width / 360), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  $("cameraStatus").textContent = `FACE TRACKED · blink L/R ${leftBlink.toFixed(2)}/${rightBlink.toFixed(2)} · eye ratio ${earText} · close threshold: blink > 0.42 or ratio < 0.22`;
  if ((state !== lastDriverState || prolongedClosure) && (prolongedClosure || prolongedMouthOpen)) {
    alertUser(prolongedClosure
      ? "Warning. Eyes appear closed for too long. Please stop safely."
      : "Possible yawn detected. Please assess your alertness.", true);
  }
  lastDriverState = state;
}
async function processFrame() {
  if (stopped || !stream || busy) {
    if (!stopped) animationId = requestAnimationFrame(processFrame);
    return;
  }
  if (video.readyState < 2) {
    animationId = requestAnimationFrame(processFrame);
    return;
  }
  busy = true;
  try {
    resizeCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (mode === "road" && cocoModel) {
      const predictions = await cocoModel.detect(video);
      const filtered = predictions.filter(p => roadClasses.has(p.class) && p.score >= 0.45);
      $("objectCount").textContent = String(filtered.length);
      for (const p of filtered) drawBox(p.bbox, p.class, p.score);
      // No distance or collision risk is inferred from bounding boxes.
      currentPredictions = filtered;
    } else if (mode === "driver" && faceLandmarker) {
      const result = faceLandmarker.detectForVideo(video, performance.now());
      processDriverResult(result);
      $("objectCount").textContent = "—";
    }
  } catch (error) {
    $("cameraStatus").textContent = `Processing issue: ${error.message}`;
  } finally {
    busy = false;
    if (!stopped) animationId = requestAnimationFrame(processFrame);
  }
}

function setMode(nextMode) {
  mode = nextMode;
  $("roadMode").classList.toggle("active", mode === "road");
  $("driverMode").classList.toggle("active", mode === "driver");
  $("modeValue").textContent = mode === "road" ? "Road detection" : "Driver monitoring";
  $("objectCount").textContent = "—";
  $("driverState").textContent = mode === "road" ? "Not monitored" : "Waiting for face";
  $("cameraStatus").textContent = `Selected ${mode === "road" ? "rear" : "front"} camera. Start camera to begin.`;
}

$("roadMode").addEventListener("click", async () => { await stopCamera(); setMode("road"); });
$("driverMode").addEventListener("click", async () => { await stopCamera(); setMode("driver"); });
$("startBtn").addEventListener("click", startCamera);
$("stopBtn").addEventListener("click", stopCamera);
$("clearLog").addEventListener("click", () => { $("eventLog").innerHTML = '<li class="muted">No events yet.</li>'; });
const testAlertBtn = $("testAlertBtn");
if (testAlertBtn) testAlertBtn.addEventListener("click", () => alertUser("Test alert. Sound and voice are enabled.", true));

$("gpsBtn").addEventListener("click", () => {
  if (!("geolocation" in navigator)) {
    $("gpsStatus").textContent = "Geolocation is not supported by this browser.";
    return;
  }
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  $("gpsStatus").textContent = "Requesting GPS permission…";
  gpsWatch = navigator.geolocation.watchPosition(position => {
    const speed = position.coords.speed;
    $("gpsSpeed").textContent = Number.isFinite(speed)
      ? `${(speed * 3.6).toFixed(1)} km/h (GPS estimate)`
      : "Unavailable";
    $("gpsStatus").textContent = `GPS updated. Accuracy: ±${Math.round(position.coords.accuracy)} m.`;
  }, error => {
    $("gpsStatus").textContent = `GPS unavailable: ${error.message}`;
    $("gpsSpeed").textContent = "Unavailable";
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("pagehide", () => {
  if (gpsWatch !== null && "geolocation" in navigator) navigator.geolocation.clearWatch(gpsWatch);
  stopCamera();
});

// Show a useful message when the page loads but external model scripts are unavailable.
window.addEventListener("load", () => {
  if (!window.cocoSsd) {
    $("cameraStatus").textContent = "TensorFlow.js COCO-SSD library did not load. Check internet access and reload this page.";
    logEvent("COCO-SSD script is unavailable; check CDN/network access.");
  }
});
