const p$ = id => document.getElementById(id);
const rearVideo = p$('parallelRearVideo'), frontVideo = p$('parallelFrontVideo');
const roadCanvas = p$('parallelRoadCanvas'), faceCanvas = p$('parallelFaceCanvas');
const roadCtx = roadCanvas.getContext('2d'), faceCtx = faceCanvas.getContext('2d');
let rearStream = null, frontStream = null, parallelOn = false, roadBusy = false, faceBusy = false;
let roadFrame = 0, faceFrame = 0, roadModel = null, faceModel = null, faceClosedSince = null, yawnSince = null, lastFatigueAlert = 0;
const pRoadClasses = new Set(['person','bicycle','car','motorcycle','bus','truck','traffic light','stop sign']);
window.getParallelRearStream = () => parallelOn ? rearStream : null;
window.isParallelModeRunning = () => parallelOn;
function pStatus(id, text){ p$(id).textContent = text; }
function sizeCanvas(video, canvas, context){
  const w=video.videoWidth||640,h=video.videoHeight||480;
  if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
}
function pAlert(message){
  const now=Date.now(); if(now-lastFatigueAlert<6000)return; lastFatigueAlert=now;
  pStatus('parallelDriverStatus',message);
  try { if (p$('voiceToggle')?.checked && 'speechSynthesis' in window) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(message)); } } catch(e){}
  try { if (p$('vibrateToggle')?.checked && 'vibrate' in navigator) navigator.vibrate([250,120,250]); } catch(e){}
  const log=p$('eventLog'); if(log){const li=document.createElement('li');li.textContent=`${new Date().toLocaleTimeString()} — ${message}`;log.prepend(li);}
}
async function pLoadModels(){
  if(!window.cocoSsd)throw new Error('TensorFlow.js COCO-SSD did not load. Check internet and reload.');
  if(!roadModel)roadModel=await window.cocoSsd.load({base:'lite_mobilenet_v2'});
  if(!faceModel){
    const mp=await import('./vendor/mediapipe/vision_bundle.mjs');
    const fileset=await mp.FilesetResolver.forVisionTasks('./vendor/mediapipe/wasm');
    faceModel=await mp.FaceLandmarker.createFromOptions(fileset,{
      baseOptions:{modelAssetPath:'./models/face_landmarker.task',delegate:'CPU'},
      runningMode:'VIDEO',numFaces:1,outputFaceBlendshapes:true
    });
  }
}
function cameraErrorText(error, role){
  if(error?.name==='NotFoundError'||error?.name==='DevicesNotFoundError'){
    return role+' camera was not found. Check that the camera exists, is enabled, and is not disabled by browser/device settings.';
  }
  if(error?.name==='NotReadableError'||error?.name==='TrackStartError'){
    return role+' camera is already in use or the device cannot open it. Close other camera apps/tabs and retry.';
  }
  if(error?.name==='NotAllowedError'||error?.name==='PermissionDeniedError'){
    return 'Camera permission was denied. Allow camera access for this website in browser settings, then reload.';
  }
  return role+' camera error: '+(error?.message||String(error));
}
async function openPreferredCamera(facingMode, width, height, role){
  const preferred={audio:false,video:{facingMode:{ideal:facingMode},width:{ideal:width},height:{ideal:height}}};
  try{return await navigator.mediaDevices.getUserMedia(preferred);}
  catch(error){
    if(!['NotFoundError','DevicesNotFoundError','OverconstrainedError','ConstraintNotSatisfiedError'].includes(error?.name)) throw new Error(cameraErrorText(error,role));
    // Some browsers do not implement facingMode consistently. Retry with any available camera.
    try{return await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:width},height:{ideal:height}}});}
    catch(fallbackError){throw new Error(cameraErrorText(fallbackError,role));}
  }
}
async function openSecondDistinctCamera(primaryStream){
  const primaryId=primaryStream?.getVideoTracks?.()[0]?.getSettings?.().deviceId;
  const devices=await navigator.mediaDevices.enumerateDevices();
  const cameras=devices.filter(device=>device.kind==='videoinput'&&device.deviceId&&device.deviceId!==primaryId);
  if(cameras.length){
    // Explicitly select a different physical camera instead of asking for a generic
    // front camera, which can resolve to the already-open rear camera on some browsers.
    try{
      return await navigator.mediaDevices.getUserMedia({audio:false,video:{deviceId:{exact:cameras[0].deviceId},width:{ideal:640},height:{ideal:480}}});
    }catch(error){
      throw new Error('A second camera was detected ('+(cameras[0].label||'camera')+'), but the browser could not open it simultaneously. '+cameraErrorText(error,'Front'));
    }
  }
  throw new Error('This device/browser did not expose a second camera. Parallel mode needs two cameras at the same time. Use Road detection and Driver monitoring separately, or try a device/browser that supports simultaneous front and rear cameras.');
}
async function startParallel(){
  if(parallelOn)return;
  p$('startParallelBtn').disabled=true;
  pStatus('parallelStatus','Loading models and checking available cameras…');
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera API unavailable. Open this site using HTTPS in a supported browser.');
    await pLoadModels();
    rearStream=await openPreferredCamera('environment',960,540,'Rear');
    rearVideo.srcObject=rearStream; await rearVideo.play();
    try{
      frontStream=await openSecondDistinctCamera(rearStream);
      frontVideo.srcObject=frontStream; await frontVideo.play();
    }catch(error){
      rearStream?.getTracks().forEach(track=>track.stop()); rearStream=null; rearVideo.srcObject=null;
      throw error;
    }
    parallelOn=true;
    for(const id of ['roadMode','driverMode','startBtn']) if(p$(id)) p$(id).disabled=true;
    p$('stopParallelBtn').disabled=false;
    pStatus('parallelStatus','All systems running: rear road detection + front driver monitoring. AR may share the rear stream.');
    pStatus('parallelRoadStatus','Rear camera active; detecting road objects…');
    pStatus('parallelDriverStatus','Front camera active; tracking face/eyes…');
    roadLoop(); faceLoop();
  }catch(e){
    // Release any partially acquired stream so the camera is not left locked.
    for(const stream of [rearStream,frontStream]) stream?.getTracks().forEach(track=>track.stop());
    rearStream=frontStream=null; rearVideo.srcObject=null; frontVideo.srcObject=null;
    pStatus('parallelStatus','Could not start all systems: '+e.message);
    p$('startParallelBtn').disabled=false;
    console.error(e);
  }
}
async function roadLoop(){
  if(!parallelOn)return;
  if(!roadBusy&&rearVideo.readyState>=2){
    roadBusy=true;
    try{
      sizeCanvas(rearVideo,roadCanvas,roadCtx); roadCtx.clearRect(0,0,roadCanvas.width,roadCanvas.height);
      const detections=await roadModel.detect(rearVideo);
      const filtered=detections.filter(d=>pRoadClasses.has(d.class)&&d.score>=0.45);
      for(const d of filtered){
        const [x,y,w,h]=d.bbox;
        roadCtx.strokeStyle='#38bdf8';roadCtx.lineWidth=Math.max(2,roadCanvas.width/400);roadCtx.strokeRect(x,y,w,h);
        const label=`${d.class} ${(d.score*100).toFixed(0)}%`;roadCtx.font=`${Math.max(13,roadCanvas.width/55)}px system-ui`;
        const tw=roadCtx.measureText(label).width;roadCtx.fillStyle='#075985';roadCtx.fillRect(x,Math.max(0,y-25),tw+10,24);
        roadCtx.fillStyle='#fff';roadCtx.fillText(label,x+5,Math.max(17,y-8));
      }
      pStatus('parallelRoadStatus',`Rear camera active · ${filtered.length} road-relevant detections. No distance estimate.`);
    }catch(e){pStatus('parallelRoadStatus','Detection issue: '+e.message);}
    finally{roadBusy=false;}
  }
  if(parallelOn)roadFrame=requestAnimationFrame(roadLoop);
}
function pScore(categories,name){return categories?.find(x=>x.categoryName===name)?.score??0;}
function pDist(a,b){return Math.hypot(a.x-b.x,a.y-b.y);}
function pEAR(l,ids){const [o,u1,u2,i,d2,d1]=ids.map(n=>l?.[n]);if(![o,u1,u2,i,d2,d1].every(Boolean))return null;const hor=pDist(o,i);return hor<.0001?null:(pDist(u1,d1)+pDist(u2,d2))/(2*hor);}
function faceLoop(){
 if(!parallelOn)return;
 if(!faceBusy&&frontVideo.readyState>=2){
  faceBusy=true;
  try{
   sizeCanvas(frontVideo,faceCanvas,faceCtx);faceCtx.clearRect(0,0,faceCanvas.width,faceCanvas.height);
   const result=faceModel.detectForVideo(frontVideo,performance.now()),landmarks=result.faceLandmarks?.[0],cats=result.faceBlendshapes?.[0]?.categories;
   if(!landmarks){faceClosedSince=null;yawnSince=null;pStatus('parallelDriverStatus','Face not detected — improve lighting and face the camera.');}
   else{
    const blink=(pScore(cats,'eyeBlinkLeft')+pScore(cats,'eyeBlinkRight'))/2;
    const ears=[pEAR(landmarks,[33,160,158,133,153,144]),pEAR(landmarks,[362,385,387,263,373,380])].filter(Number.isFinite);
    const ear=ears.length?ears.reduce((a,b)=>a+b,0)/ears.length:null;
    const closed=blink>.42||(ear!==null&&ear<.22), yawn=pScore(cats,'jawOpen')>.65, now=performance.now();
    if(closed){if(faceClosedSince===null)faceClosedSince=now;}else faceClosedSince=null;
    if(yawn){if(yawnSince===null)yawnSince=now;}else yawnSince=null;
    const prolonged=faceClosedSince!==null&&now-faceClosedSince>1200, prolongedYawn=yawnSince!==null&&now-yawnSince>1200;
    const state=prolonged?'WARNING: eyes closed too long':prolongedYawn?'Possible yawn':closed?'Eyes closed — timing':'Eyes open (estimate)';
    for(const i of [33,160,158,133,153,144,362,385,387,263,373,380]){const pt=landmarks[i];if(pt){faceCtx.fillStyle='#22c55e';faceCtx.beginPath();faceCtx.arc(pt.x*faceCanvas.width,pt.y*faceCanvas.height,Math.max(2,faceCanvas.width/360),0,Math.PI*2);faceCtx.fill();}}
    pStatus('parallelDriverStatus',`Face tracked · ${state} · blink ${blink.toFixed(2)} · eye ratio ${ear===null?'n/a':ear.toFixed(3)}`);
    if(prolonged)pAlert('Warning. Eyes appear closed for too long. Please stop safely.');
    else if(prolongedYawn)pAlert('Possible yawn detected. Please assess your alertness.');
   }
  }catch(e){pStatus('parallelDriverStatus','Face processing issue: '+e.message);}
  finally{faceBusy=false;}
 }
 if(parallelOn)faceFrame=requestAnimationFrame(faceLoop);
}
function stopParallel(){
 parallelOn=false;
 if(roadFrame)cancelAnimationFrame(roadFrame);if(faceFrame)cancelAnimationFrame(faceFrame);
 for(const s of [rearStream,frontStream])if(s)s.getTracks().forEach(t=>t.stop());
 rearStream=frontStream=null;rearVideo.srcObject=null;frontVideo.srcObject=null;
 roadCtx.clearRect(0,0,roadCanvas.width,roadCanvas.height);faceCtx.clearRect(0,0,faceCanvas.width,faceCanvas.height);
 for(const id of ['roadMode','driverMode','startBtn']) if(p$(id)) p$(id).disabled=false;
 p$('startParallelBtn').disabled=false;p$('stopParallelBtn').disabled=true;
 pStatus('parallelStatus','Parallel mode stopped.');pStatus('parallelRoadStatus','Waiting for rear camera.');pStatus('parallelDriverStatus','Waiting for front camera.');
}
p$('startParallelBtn').addEventListener('click',startParallel);
p$('stopParallelBtn').addEventListener('click',stopParallel);
window.addEventListener('pagehide',stopParallel);
