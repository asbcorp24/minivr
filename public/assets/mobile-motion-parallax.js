// Bounded tilt-based positional parallax for a phone held in one hand.
// DeviceOrientation measures rotation, not true physical translation.
export function createMobileMotionParallax(host=window){
 let active=false,neutral=null,screenAngle=null,resolveFirst=null;
 let targetX=0,targetY=0,x=0,y=0,lastSample=0;
 const clamp=value=>Math.max(-1,Math.min(1,value));
 const difference=(a,b)=>((a-b+540)%360)-180;
 const angle=()=>((Number(host.screen?.orientation?.angle??host.orientation??0)%360)+360)%360;

 function recenter(){neutral=null;targetX=0;targetY=0;x=0;y=0;}
 function sample(event){
  if(!active||!Number.isFinite(event.beta)||!Number.isFinite(event.gamma))return;
  const rotation=angle(),beta=event.beta,gamma=event.gamma;
  if(rotation!==screenAngle){screenAngle=rotation;recenter();}
  // Translate portrait/landscape device axes into screen-relative axes.
  let sx=gamma,sy=beta;
  if(rotation===90){sx=-beta;sy=gamma;}
  else if(rotation===180){sx=-gamma;sy=-beta;}
  else if(rotation===270){sx=beta;sy=-gamma;}
  if(!neutral)neutral={x:sx,y:sy};
  // A 10-15° tilt should produce a noticeable cue even on narrow portrait screens.
  // The viewer still caps camera translation to protect foreground silhouettes.
  targetX=clamp(difference(sx,neutral.x)/14);
  targetY=clamp(-difference(sy,neutral.y)/18);
  lastSample=Date.now();
  if(resolveFirst){resolveFirst(true);resolveFirst=null;}
 }

 function stop(){
  active=false;
  host.removeEventListener('deviceorientation',sample);
  host.removeEventListener('orientationchange',recenter);
  host.screen?.orientation?.removeEventListener?.('change',recenter);
  if(resolveFirst){resolveFirst(false);resolveFirst=null;}
  recenter();lastSample=0;screenAngle=null;
 }

 async function start(){
  if(active)return true;
  if(!host.isSecureContext||!host.DeviceOrientationEvent)return false;
  try{
   const sensor=host.DeviceOrientationEvent;
   if(typeof sensor.requestPermission==='function'&&await sensor.requestPermission()!=='granted')return false;
  }catch{return false;}
  active=true;screenAngle=angle();recenter();
  host.addEventListener('deviceorientation',sample);
  host.addEventListener('orientationchange',recenter);
  host.screen?.orientation?.addEventListener?.('change',recenter);
  const first=await new Promise(resolve=>{
   const timeout=setTimeout(()=>{if(resolveFirst){resolveFirst=null;resolve(false);}},1500);
   resolveFirst=ok=>{clearTimeout(timeout);resolve(ok);};
  });
  if(!first)stop();
  return first;
 }

 function update(dt){
  if(!active||Date.now()-lastSample>1600){targetX=0;targetY=0;}
  const damping=1-Math.exp(-Math.max(0,Math.min(.05,dt))*6);
  x+=(targetX-x)*damping;y+=(targetY-y)*damping;
  return {x,y};
 }

 return {start,stop,recenter,update,isActive:()=>active};
}
