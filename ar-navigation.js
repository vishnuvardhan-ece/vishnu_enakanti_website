const $ar = id => document.getElementById(id);
const arVideo = $ar('arVideo');
let arStream = null, arUsingSharedStream = false, arWatchId = null, arHeading = null, arCurrent = null, arSteps = [], arStepIndex = 0, arDestination = null, arLastSpoken = -1, arLastPosition = null;
const rad = d => d * Math.PI / 180;
const deg = r => (r * 180 / Math.PI + 360) % 360;
function arDistance(a,b){ const R=6371000, dLat=rad(b.lat-a.lat), dLon=rad(b.lon-a.lon); const x=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2; return 2*R*Math.asin(Math.sqrt(x)); }
function arBearing(a,b){ const p1=rad(a.lat),p2=rad(b.lat),dl=rad(b.lon-a.lon); return deg(Math.atan2(Math.sin(dl)*Math.cos(p2),Math.cos(p1)*Math.sin(p2)-Math.sin(p1)*Math.cos(p2)*Math.cos(dl))); }
function arSpeak(text){ if(!text)return; try { if('speechSynthesis' in window){ speechSynthesis.cancel(); const u=new SpeechSynthesisUtterance(text); u.rate=.92; u.volume=1; speechSynthesis.speak(u); } }catch(e){console.warn('Speech unavailable',e);} }
function arMeters(m){ return m>=1000 ? (m/1000).toFixed(1)+' km' : Math.max(0,Math.round(m))+' m'; }
function arManeuverText(step){ if(!step)return 'Follow the route'; const t=step.maneuver?.type||'continue', mod=step.maneuver?.modifier||''; const road=step.name ? ' onto '+step.name : ''; if(t==='arrive')return 'You have arrived'; if(t==='depart')return 'Start driving'+road; if(t==='turn')return 'Turn '+(mod||'ahead')+road; if(t==='fork')return 'Keep '+(mod||'to the main road')+road; if(t==='merge')return 'Merge '+(mod||'ahead')+road; if(t==='roundabout'||t==='rotary')return 'At the roundabout, take the indicated exit'+road; if(t==='continue'||t==='new name')return 'Continue straight'+road; if(t==='end of road')return 'At the end of the road, turn '+(mod||'ahead')+road; return t.replaceAll('_',' ')+(mod?' '+mod:'')+road; }
async function arFindRoute(){
 const status=$ar('routeStatus'), query=$ar('destinationInput').value.trim(); if(!query){status.textContent='Enter a destination first.';return;}
 if(!navigator.geolocation){status.textContent='GPS is not supported in this browser.';return;}
 status.textContent='Getting your current GPS location…';
 try{
  const pos=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:15000,maximumAge:0}));
  arCurrent={lat:pos.coords.latitude,lon:pos.coords.longitude};
  status.textContent='Finding destination…';
  const geo=await fetch('https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q='+encodeURIComponent(query));
  if(!geo.ok)throw new Error('Destination search service unavailable'); const places=await geo.json(); if(!places.length)throw new Error('Destination not found. Try a more specific address.');
  arDestination={lat:Number(places[0].lat),lon:Number(places[0].lon),name:places[0].display_name};
  status.textContent='Calculating driving route…';
  const url=`https://router.project-osrm.org/route/v1/driving/${arCurrent.lon},${arCurrent.lat};${arDestination.lon},${arDestination.lat}?overview=false&steps=true`;
  const rr=await fetch(url); if(!rr.ok)throw new Error('Routing service unavailable'); const data=await rr.json(); if(data.code!=='Ok'||!data.routes?.length)throw new Error('No driving route found for this destination.');
  arSteps=data.routes[0].legs[0].steps||[]; arStepIndex=Math.min(1,Math.max(0,arSteps.length-1)); arLastSpoken=-1; arLastPosition=arCurrent;
  status.textContent=`Route loaded: ${arMeters(data.routes[0].distance)}, estimated ${Math.round(data.routes[0].duration/60)} min. ${arSteps.length} route steps. GPS accuracy ±${Math.round(pos.coords.accuracy)} m.`;
  if(arSteps.length){const text=arManeuverText(arSteps[arStepIndex]);$ar('arManeuver').textContent=text;$ar('arDistance').textContent='GPS active · follow route'; arSpeak('Route loaded. '+text);}
 }catch(e){status.textContent='Route error: '+(e.message||'Unable to calculate route')+'. Check location permission and internet.';}
}
async function arStartCamera(){
 try{ if(arStream)return; if(!navigator.mediaDevices?.getUserMedia)throw new Error('Camera requires HTTPS on your phone.');
  const sharedRear = window.getParallelRearStream?.();
  if(sharedRear){ arStream=sharedRear; arUsingSharedStream=true; }
  else { arStream=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}}}); arUsingSharedStream=false; }
  arVideo.srcObject=arStream; await arVideo.play(); $ar('startArBtn').disabled=true; $ar('stopArBtn').disabled=false; $ar('routeStatus').textContent=arUsingSharedStream?'AR is sharing the parallel mode rear-camera stream. Keep the phone mounted; test while parked.':'AR camera active. Keep the phone securely mounted; use only while parked for testing.';
  if(navigator.geolocation){ arWatchId=navigator.geolocation.watchPosition(p=>{const prev=arCurrent; arCurrent={lat:p.coords.latitude,lon:p.coords.longitude}; if(Number.isFinite(p.coords.heading)&&p.coords.heading>=0)arHeading=p.coords.heading; updateAR(); },e=>{$ar('routeStatus').textContent='GPS update failed: '+e.message;},{enableHighAccuracy:true,maximumAge:1000,timeout:10000}); }
  window.addEventListener('deviceorientationabsolute',arOrientation); window.addEventListener('deviceorientation',arOrientation);
  if(!arDestination) $ar('arManeuver').textContent='Find a route first';
 }catch(e){$ar('routeStatus').textContent='Could not start AR camera: '+e.message; arStopCamera();}
}
function arOrientation(e){ let h; if(typeof e.webkitCompassHeading==='number')h=e.webkitCompassHeading; else if(e.absolute&&typeof e.alpha==='number')h=(360-e.alpha)%360; if(Number.isFinite(h))arHeading=h; updateAR(); }
function updateAR(){ if(!arCurrent||!arSteps.length){$ar('arDistance').textContent='Waiting for GPS route';return;} let step=arSteps[Math.min(arStepIndex,arSteps.length-1)]; let loc=step?.maneuver?.location; if(loc){const d=arDistance(arCurrent,{lat:loc[1],lon:loc[0]}); if(d<28&&arStepIndex<arSteps.length-1){arStepIndex++;step=arSteps[arStepIndex]; if(arLastSpoken!==arStepIndex){arSpeak(arManeuverText(step));arLastSpoken=arStepIndex;}} const target=step?.maneuver?.location; if(target){const b=arBearing(arCurrent,{lat:target[1],lon:target[0]}); if(arHeading!==null){let rel=((b-arHeading+540)%360)-180;$ar('arArrow').style.transform=`rotate(${rel}deg)`;} else {$ar('arArrow').style.transform='rotate(0deg)';} $ar('arDistance').textContent=`${arMeters(d)} to next maneuver`;} $ar('arManeuver').textContent=arManeuverText(step); if(step?.maneuver?.type==='arrive'&&d<30){$ar('arManeuver').textContent='You have arrived';if(arLastSpoken!==arStepIndex){arSpeak('You have arrived at your destination');arLastSpoken=arStepIndex;}} }
}
function arStopCamera(){if(arStream&&!arUsingSharedStream){arStream.getTracks().forEach(t=>t.stop());} arStream=null;arUsingSharedStream=false; arVideo.srcObject=null; if(arWatchId!==null&&navigator.geolocation){navigator.geolocation.clearWatch(arWatchId);arWatchId=null;} window.removeEventListener('deviceorientationabsolute',arOrientation);window.removeEventListener('deviceorientation',arOrientation);$ar('startArBtn').disabled=false;$ar('stopArBtn').disabled=true;}
$ar('routeBtn').addEventListener('click',arFindRoute);$ar('startArBtn').addEventListener('click',arStartCamera);$ar('stopArBtn').addEventListener('click',arStopCamera);$ar('repeatInstructionBtn').addEventListener('click',()=>arSpeak($ar('arManeuver').textContent));
window.addEventListener('pagehide',arStopCamera);
