import {createEnvironment} from '/assets/panorama-environment.js';
import {createMoonlight} from '/assets/panorama-moonlight.js';
import {createAtmosphere} from '/assets/panorama-atmosphere.js';
import {createPanoramaEffects} from '/assets/panorama-effects.js';
import {createTiledPanorama} from '/assets/tiled-panorama.js';
import * as THREE from '/assets/vendor/three/three.module.js';
import DeviceOrientationControls from '/assets/vendor/three/DeviceOrientationControls.js';
import VREffect from '/assets/vendor/three/effects/VREffect.js';
import VRControls from '/assets/vendor/three/controls/VRControls.js';

const root=document.querySelector('#viewer');
const immersiveLaunch=new URLSearchParams(location.search).get('immersive')==='1';
if(immersiveLaunch){
 document.documentElement.classList.add('minivr-immersive-launch');
 const immersiveCss=document.createElement('style');
 immersiveCss.textContent='.minivr-immersive-launch #top{display:none!important}.minivr-immersive-launch #viewer{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important}';
 document.head.appendChild(immersiveCss);
 // Browsers normally prohibit requestFullscreen without a user gesture.
 // Try once on arrival; otherwise activate on the first intentional click.
 const requestFullscreen=()=>{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});};
 document.addEventListener('pointerdown',requestFullscreen,{once:true,capture:true});
 requestFullscreen();
}

let effectSettings={};try{effectSettings=JSON.parse(root.dataset.effects||'{}')}catch(e){}
effectSettings.timeOfDay=false;effectSettings.dayCycle=false;
let effectSystem=null,atmosphereSystem=null,moonSystem=null,environmentSystem=null,lastEffectTime=0;
// Opt-in diagnostics: /viewer.php?id=...&effects_debug=1
if(new URLSearchParams(location.search).has('effects_debug')){
 const diagnostic=document.createElement('pre');
 diagnostic.id='minivr-effects-diagnostics';
 diagnostic.style.cssText='position:fixed;top:56px;left:8px;z-index:999999;max-width:min(94vw,440px);max-height:55vh;overflow:auto;background:rgba(0,0,0,.88);color:#aaffcc;padding:12px;border:1px solid #5b9;font:12px/1.45 monospace;white-space:pre-wrap;pointer-events:none';
 const report=()=>{diagnostic.textContent='MiniVR / effects debug\\n'+JSON.stringify(effectSettings,null,2)+'\\nModules: '+[!!effectSystem,!!atmosphereSystem,!!moonSystem,!!environmentSystem].join(' / ')};
 document.addEventListener('DOMContentLoaded',()=>{document.body.appendChild(diagnostic);report()});
 window.addEventListener('error',e=>{diagnostic.textContent+='\\nERROR: '+e.message});
 window.addEventListener('unhandledrejection',e=>{diagnostic.textContent+='\\nREJECTION: '+String(e.reason)});
}

let projection=root.dataset.projection||'360', stereoMode=root.dataset.stereo||'mono';
const tour=Number(root.dataset.tour||0),backUrl=root.dataset.back||'/';let hotspotData=JSON.parse(document.querySelector('#hotspots-data')?.textContent||'[]');
const tourData=JSON.parse(document.querySelector('#tour-data')?.textContent||'{"scenes":[],"current":-1}');
// Guided tour: each scene has its own duration; 0 disables automatic advance.
let tourTimer=null,tourDeadline=0,tourPaused=false;
function currentTourDuration(){
 const item=tourData.scenes[tourData.current];
 const override=item?.duration_seconds;
 const fallback=Number(effectSettings.tourDuration??30);
 return Math.max(0,Math.min(3600,Number(override===null||override===undefined?fallback:override)||0));
}
const tourButton=document.createElement('button');
tourButton.type='button';tourButton.id='tour-autoplay';tourButton.style.cssText='background:#153849;color:white;border:1px solid #43849d;border-radius:8px;padding:7px 10px;cursor:pointer';
tourButton.addEventListener('click',()=>{tourPaused=!tourPaused;resetTourTimer()});
function resetTourTimer(){
 if(tourTimer){clearTimeout(tourTimer);tourTimer=null}
 const duration=currentTourDuration();
 const next=tourData.current+1<tourData.scenes.length;
 tourButton.textContent=tourPaused?'▶ Продолжить экскурсию':'⏸ Авто: '+duration+' с';
 tourButton.title='Автоматический переход к следующей панораме';
 if(!tour||!next||!duration||tourPaused)return;
 tourDeadline=Date.now()+duration*1000;
 tourTimer=setTimeout(()=>{tourTimer=null;if(!tourPaused&&document.visibilityState==='visible')goScene(tourData.current+1);else resetTourTimer()},duration*1000);
}
if(tour&&tourData.scenes.length>1){document.querySelector('#controls')?.prepend(tourButton);resetTourTimer()}
document.addEventListener('visibilitychange',()=>{if(tour&&document.visibilityState==='visible')resetTourTimer();else if(tourTimer){clearTimeout(tourTimer);tourTimer=null}});
// Desktop-only tour scene rail: lightweight DOM, no additional WebGL resources.
const tourRail=document.createElement('nav');
tourRail.id='minivr-tour-rail';
tourRail.setAttribute('aria-label','Панорамы экскурсии');
tourRail.style.cssText='position:fixed;right:clamp(12px,2vw,28px);top:50%;transform:translateY(-50%);z-index:800;display:flex;flex-direction:column;align-items:center;gap:11px;padding:15px 11px;border:1px solid rgba(255,255,255,.18);border-radius:28px;background:rgba(12,29,42,.52);backdrop-filter:blur(14px);box-shadow:0 8px 32px #0004;max-height:75vh;overflow-y:auto;scrollbar-width:thin';
const railStyle=document.createElement('style');
railStyle.textContent='#minivr-tour-rail button{appearance:none;position:relative;width:12px;height:12px;min-height:12px;border-radius:50%;border:2px solid rgba(230,246,255,.75);background:rgba(255,255,255,.28);cursor:pointer;transition:transform .2s,background .2s,box-shadow .2s;padding:0}#minivr-tour-rail button:hover,#minivr-tour-rail button:focus-visible{transform:scale(1.3);background:#8defff;outline:none;box-shadow:0 0 0 5px #78eaff35}#minivr-tour-rail button[aria-current="step"]{width:15px;height:15px;min-height:15px;background:#85efff;border-color:#fff;box-shadow:0 0 0 5px #67d9ff35,0 0 14px #67d9ff}#minivr-tour-rail button::before{content:attr(data-label);position:absolute;right:calc(100% + 20px);top:50%;transform:translateY(-50%) translateX(5px);opacity:0;pointer-events:none;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;color:white;background:#112b3deF;border:1px solid #ffffff35;border-radius:9px;padding:8px 12px;font:13px system-ui;transition:opacity .15s,transform .15s}#minivr-tour-rail button:hover::before,#minivr-tour-rail button:focus-visible::before{opacity:1;transform:translateY(-50%) translateX(0)}@media(max-width:767px){#minivr-tour-rail{display:none!important}}';
document.head.appendChild(railStyle);
function syncTourRail(){
 const desktop=window.innerWidth>=768&&!cardboard&&!legacyCardboard&&!(typeof renderer!=='undefined'&&renderer.xr.isPresenting);
 tourRail.style.display=desktop?'flex':'none';
 for(const [i,button] of Array.from(tourRail.querySelectorAll('button')).entries()){
  if(i===tourData.current){button.setAttribute('aria-current','step');button.setAttribute('aria-label','Текущая панорама: '+(tourData.scenes[i]?.title||'Панорама '+(i+1)))}else{button.removeAttribute('aria-current');button.setAttribute('aria-label','Перейти: '+(tourData.scenes[i]?.title||'Панорама '+(i+1)))}
 }
}
if(tour&&tourData.scenes.length>1){
 tourData.scenes.forEach((item,i)=>{const b=document.createElement('button');b.type='button';b.dataset.label=(i+1)+'. '+(item.title||'Панорама '+(i+1));b.title=b.dataset.label;b.addEventListener('click',()=>goScene(i));tourRail.appendChild(b)});
 document.body.appendChild(tourRail);
 window.addEventListener('resize',syncTourRail);requestAnimationFrame(syncTourRail);
}
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,1100);
effectSystem=createPanoramaEffects(scene,effectSettings);atmosphereSystem=createAtmosphere(scene,effectSettings);moonSystem=createMoonlight(scene,effectSettings);environmentSystem=createEnvironment(scene,effectSettings);
let renderer;
try{
 renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'default',preserveDrawingBuffer:false});
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
 renderer.xr.enabled=true;
 root.appendChild(renderer.domElement);
 renderer.domElement.addEventListener('webglcontextlost',event=>{
  event.preventDefault();
  console.warn('MiniVR: WebGL context lost; waiting for browser restoration');
  let notice=document.getElementById('minivr-webgl-notice');
  if(!notice){notice=document.createElement('div');notice.id='minivr-webgl-notice';notice.style.cssText='position:absolute;z-index:9999;inset:20px auto auto 20px;padding:16px;background:#172631;color:white;border-radius:10px;max-width:380px';root.appendChild(notice)}
  notice.textContent='Графический контекст потерян. Закройте другие 3D-вкладки и дождитесь восстановления.';
 },false);
 renderer.domElement.addEventListener('webglcontextrestored',()=>{
  document.getElementById('minivr-webgl-notice')?.remove();
  console.info('MiniVR: WebGL context restored');
 },false);
}catch(error){
 console.error('MiniVR: WebGL initialization failed',error);
 const notice=document.createElement('div');notice.style.cssText='padding:24px;background:#182e3b;color:#fff;max-width:600px;margin:30px auto;border-radius:12px';
 notice.textContent='Не удалось запустить 3D-просмотр: WebGL заблокирован браузером. Закройте другие вкладки с 3D, перезапустите браузер и проверьте аппаратное ускорение.';
 root.appendChild(notice);
 throw error;
}
let cardboard=false,lon=0,lat=0,down=false,x0=0,y0=0,lon0=0,lat0=0,orientation=false,leftMesh,rightMesh;
const cardboardStereo=new THREE.StereoCamera();cardboardStereo.eyeSep=.064;
const legacyVREffect=new VREffect(renderer);const legacyVRControls=new VRControls(camera);let legacyVRDisplay=null,legacyCardboard=false;
const ViewerMode=Object.freeze({DESKTOP:'desktop',CARDBOARD:'cardboard',WEBXR:'webxr'});
function getViewerMode(){if(renderer.xr.isPresenting)return ViewerMode.WEBXR;if(legacyCardboard||cardboard)return ViewerMode.CARDBOARD;return ViewerMode.DESKTOP}

const deviceOrientation=new DeviceOrientationControls(camera);deviceOrientation.enabled=false;
const cardboardDebug=new THREE.Group();cardboardDebug.visible=false;cardboardDebug.layers.enableAll();scene.add(cardboardDebug);
const xrDebug=new THREE.Group();xrDebug.visible=false;xrDebug.layers.set(0);xrDebug.position.set(0,1.6,-2.5);scene.add(xrDebug);
const xrDebugCube=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),new THREE.MeshBasicMaterial({color:0x39ff14,depthTest:false}));xrDebugCube.position.set(0,0,-2.2);xrDebugCube.renderOrder=1100;xrDebug.add(xrDebugCube);
{const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#001400';c.fillRect(0,0,512,128);c.strokeStyle='#39ff14';c.lineWidth=8;c.strokeRect(4,4,504,120);c.fillStyle='#fff';c.font='bold 40px monospace';c.textAlign='center';c.fillText('WEBXR TEST',256,80);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.position.set(0,-.65,-2.2);sp.scale.set(2.3,.58,1);sp.renderOrder=1101;xrDebug.add(sp)}
const debugCube=new THREE.Mesh(new THREE.BoxGeometry(.65,.65,.65),new THREE.MeshBasicMaterial({color:0xff2bd6,depthTest:false}));debugCube.position.set(0,0,-3);debugCube.renderOrder=1000;cardboardDebug.add(debugCube);
{const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#001018';c.fillRect(0,0,512,128);c.strokeStyle='#00ffff';c.lineWidth=8;c.strokeRect(4,4,504,120);c.fillStyle='#fff';c.font='bold 42px monospace';c.textAlign='center';c.fillText('VR TEST',256,80);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.position.set(0,-.75,-3);sp.scale.set(2.2,.55,1);sp.renderOrder=1001;cardboardDebug.add(sp)}

function eyeTexture(source,eye){
 const t=source.clone();t.needsUpdate=true;t.colorSpace=THREE.SRGBColorSpace;
 if(stereoMode==='sbs'){t.repeat.set(.5,1);t.offset.set(eye==='left'?0:.5,0)}
 else if(stereoMode==='tb'){t.repeat.set(1,.5);t.offset.set(0,eye==='left'?.5:0)}
 return t;
}
let parallaxDepthPixels=null;
let manualFoliageMaskImage=null;
let manualWaterMaskImage=null,waterMotionMask=null;
async function loadManualWaterMask(){manualWaterMaskImage=null;if(!effectSettings.parallaxWaterMotion||!effectSettings.parallaxWaterMask)return;try{const img=new Image();img.src=effectSettings.parallaxWaterMask;await img.decode();manualWaterMaskImage=img;}catch(e){console.warn('MiniVR water mask unavailable',e);}}
async function loadManualFoliageMask(){
 manualFoliageMaskImage=null;
 if(!effectSettings.parallaxFoliageMask)return;
 try{const img=new Image();img.src=effectSettings.parallaxFoliageMask;await img.decode();manualFoliageMaskImage=img;}
 catch(e){console.warn('MiniVR manual foliage mask unavailable',e);}
}
async function loadParallaxDepth(){
 if(projection!=='360'||stereoMode!=='mono'||!effectSettings.parallaxEnabled||!effectSettings.parallaxDepth)return;
 try{
  const img=new Image();img.crossOrigin='anonymous';img.src=effectSettings.parallaxDepth;await img.decode();
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,256,128);
  parallaxDepthPixels=ctx.getImageData(0,0,256,128).data;
 }catch(e){console.warn('MiniVR depth map unavailable',e);}
}
function sampleDepthBilinear(u,v){
 // Longitude wraps at the seam; latitude clamps at the poles.
 const x=((u%1)+1)%1*256-.5,y=Math.max(0,Math.min(127,(1-v)*128-.5));
 const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 const read=(ix,iy)=>parallaxDepthPixels[(Math.max(0,Math.min(127,iy))*256+((ix%256)+256)%256)*4]/255;
 const top=read(x0,y0)*(1-fx)+read(x0+1,y0)*fx;
 const bottom=read(x0,y0+1)*(1-fx)+read(x0+1,y0+1)*fx;
 return top*(1-fy)+bottom*fy;
}
// Optional near-field emphasis. Depth maps use 0=far and 1=near.
function remapParallaxDepth(depth){
 if(!effectSettings.parallaxNonlinear)return depth;
 const strength=THREE.MathUtils.clamp(Number(effectSettings.parallaxNonlinearStrength??50),0,100)/100;
 // Smoothly preserve distant geometry while expanding the near-field response.
 return THREE.MathUtils.lerp(depth,Math.pow(depth,2.2),strength);
}
function applyDepthGeometry(g){
 if(!parallaxDepthPixels)return;
 const uv=g.getAttribute('uv'),pos=g.getAttribute('position');
 const strength=Math.max(0,Math.min(100,Number(effectSettings.parallaxStrength)||0))/100;
 if(strength<=0)return;
 // Depth-map values are relative, not metric distances. Map them to a bounded
 // inverse-depth shell: nearby pixels move more than distant pixels.
 const near=12,far=46;
 const radii=new Float32Array(pos.count);
 for(let i=0;i<pos.count;i++){
  const u=uv.getX(i),v=uv.getY(i);
  let depth=sampleDepthBilinear(u,v);
  // Suppress noise at the poles where many triangles converge.
  const polarFade=Math.min(1,Math.max(0,Math.sin(Math.PI*v)*8));
  depth=.5+(depth-.5)*polarFade;
  depth=remapParallaxDepth(depth);
  const inverseDistance=(1/far)+(1/near-1/far)*depth;
  const mapped=1/inverseDistance;
  radii[i]=THREE.MathUtils.lerp(26,mapped,strength);
 }
 // One mild mesh-space smoothing pass avoids jagged depth steps and cracks.
 const width=257,height=129;
 if(pos.count===width*height){
  const smooth=new Float32Array(radii);
  for(let y=1;y<height-1;y++)for(let x=0;x<width;x++){
   const i=y*width+x;
   const left=y*width+(x===0?width-2:x-1),right=y*width+(x===width-1?1:x+1);
   smooth[i]=radii[i]*.7+(radii[left]+radii[right]+radii[i-width]+radii[i+width])*.075;
  }
  radii.set(smooth);
  // The duplicated longitude seam must have exactly identical positions.
  for(let y=0;y<height;y++){const l=y*width,r=l+width-1;const avg=(radii[l]+radii[r])*.5;radii[l]=avg;radii[r]=avg;}
 }
 for(let i=0;i<pos.count;i++){
  const old=Math.hypot(pos.getX(i),pos.getY(i),pos.getZ(i))||500;
  const scale=radii[i]/old;
  pos.setXYZ(i,pos.getX(i)*scale,pos.getY(i)*scale,pos.getZ(i)*scale);
 }
 pos.needsUpdate=true;
 g.computeVertexNormals();
 g.computeBoundingSphere();
}

function geometry(aspect=16/9){
 if(projection==='flat'){const h=2.7,w=h*aspect;return new THREE.PlaneGeometry(w,h)}
 if(projection==='180') return new THREE.SphereGeometry(500,64,40,0,Math.PI);
 const g=new THREE.SphereGeometry(500,parallaxDepthPixels?256:64,parallaxDepthPixels?128:40);applyDepthGeometry(g);return g;
}
function sourceAspect(source){const im=source.image;if(!im?.width||!im?.height)return 16/9;let w=im.width,h=im.height;if(stereoMode==='sbs')w/=2;else if(stereoMode==='tb')h/=2;return w/h}
function makeEye(source,eye){
 const g=geometry(sourceAspect(source));if(effectSettings.mirrorHorizontal){const uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}const m=new THREE.MeshBasicMaterial({map:eyeTexture(source,eye),side:projection==='flat'?THREE.FrontSide:THREE.BackSide});
 const mesh=new THREE.Mesh(g,m);
 if(projection==='flat'){mesh.position.set(3.2,0,0);mesh.rotation.y=-Math.PI/2;}
 else if(projection==='180')mesh.rotation.y=Math.PI/2;
 mesh.layers.set(eye==='left'?1:2);scene.add(mesh);return mesh;
}
// A lightweight, local depth-guided background approximation. This is not
// generative AI: unknown pixels are propagated from nearby visible background.
function makeDepthBackground(source){
 if(!parallaxDepthPixels||effectSettings.parallaxOcclusionFill===false)return null;
 const image=source.image;
 if(!image?.width||!image?.height)return null;
 try{
  const w=512,h=256,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);
  const frame=ctx.getImageData(0,0,w,h),pixels=frame.data;
  const original=new Uint8ClampedArray(pixels),mask=new Uint8Array(w*h);
  // Foreground pixels are replaced by nearest known background colors.
  let count=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const depth=sampleDepthBilinear((x+.5)/w,1-(y+.5)/h);
   if(depth>.64){mask[y*w+x]=1;count++;}
  }
  if(!count||count>w*h*.75)return null;
  let known=new Uint8Array(w*h);
  for(let i=0;i<known.length;i++)known[i]=mask[i]?0:1;
  for(let pass=0;pass<48;pass++){
   const next=known.slice(),updates=[];
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(known[i])continue;
    const neighbors=[y*w+(x+w-1)%w,y*w+(x+1)%w];
    if(y>0)neighbors.push(i-w);
    if(y<h-1)neighbors.push(i+w);
    let r=0,g=0,b=0,n=0;
    for(const j of neighbors)if(known[j]){r+=pixels[j*4];g+=pixels[j*4+1];b+=pixels[j*4+2];n++;}
    if(n){updates.push([i,r/n,g/n,b/n]);next[i]=1;}
   }
   if(!updates.length)break;
   for(const [i,r,g,b] of updates){pixels[i*4]=r;pixels[i*4+1]=g;pixels[i*4+2]=b;}
   known=next;
  }
  // Keep non-foreground pixels faithful to the original panorama.
  for(let i=0;i<mask.length;i++)if(!mask[i])pixels.set(original.subarray(i*4,i*4+4),i*4);
  ctx.putImageData(frame,0,0);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=THREE.RepeatWrapping;
  const geo=new THREE.SphereGeometry(80,96,48);
  if(effectSettings.mirrorHorizontal){const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,depthWrite:false}));
  mesh.layers.set(0);mesh.renderOrder=-10;
  return mesh;
 }catch(err){console.warn('Depth background fill unavailable',err);return null;}
}
let depthBackgroundMesh=null;
let aiBackgroundMesh=null;
function installAiBackground(){
 if(aiBackgroundMesh){scene.remove(aiBackgroundMesh);aiBackgroundMesh.geometry.dispose();aiBackgroundMesh.material.map?.dispose();aiBackgroundMesh.material.dispose();aiBackgroundMesh=null;}
 if(!parallaxDepthPixels||projection!=='360'||stereoMode!=='mono'||!effectSettings.parallaxBackground)return;
 const url=effectSettings.parallaxBackground;
 new THREE.TextureLoader().load(url,texture=>{
  texture.colorSpace=THREE.SRGBColorSpace;
  const geo=new THREE.SphereGeometry(80,96,48);
  if(effectSettings.mirrorHorizontal){const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}
  const mesh=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,depthWrite:false}));
  mesh.layers.set(0);mesh.renderOrder=-10;scene.add(mesh);aiBackgroundMesh=mesh;
 },undefined,err=>console.warn('AI background unavailable',err));
}
// Hybrid parallax: five overlapping depth bands on independent transparent
// meshes. Each mesh keeps continuous per-vertex depth (no flat cut-outs).
// Original 2:1 panorama and longitude seam are preserved.
let hybridMeshes=[];
function clearHybridMeshes(){
 microMotionMaterials.length=0;
 if(foliageWindMask){foliageWindMask.dispose();foliageWindMask=null;}
 if(waterMotionMask){waterMotionMask.dispose();waterMotionMask=null;}
 for(const mesh of hybridMeshes){scene.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();}
 hybridMeshes=[];
}
// Fast local foliage candidate mask: chromatic green dominance + local texture.
// It is a conservative browser-only heuristic, not semantic AI segmentation.
// Seasonal foliage candidate classifier: green, yellow-green, gold, orange,
// muted red and brown. Texture and local colour variation suppress flat walls.
// This is an inexpensive heuristic, NOT semantic foliage segmentation.
function foliageMaskForGeometry(geo,imagePixels,w,h){
 const uv=geo.getAttribute('uv'),out=new Float32Array(uv.count);
 const sample=(x,y)=>{
  x=((x%w)+w)%w;y=Math.max(0,Math.min(h-1,y));
  const i=(y*w+x)*4,r=imagePixels[i]/255,g=imagePixels[i+1]/255,b=imagePixels[i+2]/255;
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo;
  if(hi<.12||hi>.94||delta<.075)return 0;
  // HSV hue in degrees, saturation and value.
  let hue=0;
  if(delta>0){
   if(hi===r)hue=60*(((g-b)/delta+6)%6);
   else if(hi===g)hue=60*((b-r)/delta+2);
   else hue=60*((r-g)/delta+4);
  }
  const saturation=delta/hi;
  // Warm red foliage excludes magenta and highly saturated artificial reds.
  const green=hue>=55&&hue<=165;
  const yellow=hue>=34&&hue<55;
  const orange=hue>=15&&hue<34;
  const red=(hue>=0&&hue<15)||(hue>=345&&hue<=360);
  const brown=hue>=10&&hue<=48&&hi<.60;
  const seasonal=green?1:yellow?.95:orange?.82:red?.62:brown?.56:0;
  return seasonal*Math.min(1,saturation*3)*(hi>.2?1:.5);
 };
 for(let i=0;i<uv.count;i++){
  const x=Math.floor((1-uv.getX(i))*w),y=Math.floor((1-uv.getY(i))*h);
  const dx=Math.max(1,Math.floor(w/512)),dy=Math.max(1,Math.floor(h/256));
  let sum=0,min=1,max=0,chromatic=0;
  for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){
   const v=sample(x+xx*dx,y+yy*dy);sum+=v;min=Math.min(min,v);max=Math.max(max,v);
   if(v>.12)chromatic++;
  }
  // Require both local fine-scale variation and a meaningful cluster of foliage colours.
  const textured=Math.min(1,(max-min)*4.5);
  const density=Math.min(1,chromatic/12);
  out[i]=Math.min(1,sum/25)*textured*density;
 }
 geo.setAttribute('foliageWeight',new THREE.Float32BufferAttribute(out,1));
}
// Per-pixel wind distortion: unlike vertex motion, this is visible even when
// foliage occupies only a few pixels inside a large sphere triangle.
const microMotionMaterials=[];
let foliageWindMask=null;
function makeFoliageWindMask(original,w,h){
 const mw=Math.min(512,w),mh=Math.min(256,h);
 const mask=document.createElement('canvas');mask.width=mw;mask.height=mh;
 const ctx=mask.getContext('2d'),frame=ctx.createImageData(mw,mh);
 const colour=(x,y)=>{
  x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));
  const i=(y*w+x)*4,r=original[i]/255,g=original[i+1]/255,b=original[i+2]/255;
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;
  if(hi<.12||hi>.96||d<.07)return 0;
  let hue=0;
  if(hi===r)hue=60*(((g-b)/d+6)%6);
  else if(hi===g)hue=60*((b-r)/d+2);
  else hue=60*((r-g)/d+4);
  const seasonal=(hue>=35&&hue<=165)?1:(hue>=12&&hue<35)?.75:(hue<12||hue>345)?.55:0;
  return seasonal*Math.min(1,d/hi*3);
 };
 for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
  const sx=Math.floor((x+.5)*w/mw),sy=Math.floor((y+.5)*h/mh);
  const step=Math.max(1,Math.floor(w/mw/2));
  let sum=0,min=1,max=0;
  for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){
   const v=colour(sx+xx*step,sy+yy*step);sum+=v;min=Math.min(min,v);max=Math.max(max,v);
  }
  const weight=Math.min(1,sum/25)*Math.min(1,(max-min)*5);
  const i=(y*mw+x)*4;
  frame.data[i]=frame.data[i+1]=frame.data[i+2]=Math.round(weight*255);
  frame.data[i+3]=255;
 }
 ctx.putImageData(frame,0,0);
 const texture=new THREE.CanvasTexture(mask);
 texture.wrapS=THREE.RepeatWrapping;texture.minFilter=THREE.LinearFilter;
 return texture;
}
function installMicroMotion(material,band,count){
 if(effectSettings.parallaxMicroMotion===false||new URLSearchParams(location.search).get('micro_motion')==='0')return;
 // Never animate every depth layer: restrict wind to the two foreground bands.
 if(!foliageWindMask)return;
 // Manual mask already defines exactly what moves; do not restrict it to depth bands.
 if(!manualFoliageMaskImage&&band<count-2)return;
 const preview=new URLSearchParams(location.search);
 const boosted=preview.get('micro_motion_preview')==='1';
 const showMask=preview.get('micro_motion_mask')==='1';
 const phase={value:0},strength={value:boosted?1:THREE.MathUtils.clamp(Number(effectSettings.parallaxMicroMotionStrength??60),0,100)/100};
 const speed=THREE.MathUtils.clamp(Number(effectSettings.parallaxMicroMotionSpeed??1),.1,5);
 material.onBeforeCompile=shader=>{
  shader.uniforms.microMotionTime=phase;
  shader.uniforms.microMotionStrength=strength;
  shader.uniforms.foliageWindMask={value:foliageWindMask};
  shader.fragmentShader='uniform float microMotionTime;\nuniform float microMotionStrength;\nuniform sampler2D foliageWindMask;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
#ifdef USE_MAP
  vec2 windUv = vMapUv;
  float windMask = texture2D(foliageWindMask,windUv).${manualFoliageMaskImage?'a':'r'};
  windMask = smoothstep(0.025, 0.32, windMask);
  float phaseA = microMotionTime*1.3 + windUv.y*34.0 + sin(windUv.x*38.0);
  float phaseB = microMotionTime*.8 + windUv.x*51.0;
  vec2 windShift = vec2(sin(phaseA)*.006 + sin(phaseB)*.002,cos(phaseB)*.003);
  windUv += windShift*windMask*microMotionStrength;
  vec4 sampledDiffuseColor = texture2D(map,windUv);
  diffuseColor *= sampledDiffuseColor;
  ${showMask ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.1, 0.75), windMask * 0.8);' : ''}
#endif
  `);
 };
 material.customProgramCacheKey=()=> 'minivr-foliage-fragment-wind-v6-'+(boosted?'preview':'normal')+(showMask?'-mask':'');
 microMotionMaterials.push({material,phase,speed});
}
function installWaterMotion(material){
 if(!waterMotionMask||new URLSearchParams(location.search).get('water_motion')==='0')return;
 const phase={value:0},strength={value:THREE.MathUtils.clamp(Number(effectSettings.parallaxWaterStrength??45),0,100)/100};
 const speed=THREE.MathUtils.clamp(Number(effectSettings.parallaxWaterSpeed??1),.1,5);
 const kind=({calm:0,sea:1,river:2,waterfall:3,underwater:4})[effectSettings.parallaxWaterType]??0;
 const direction=THREE.MathUtils.degToRad(Number(effectSettings.parallaxWaterDirection)||0);
 const previous=material.onBeforeCompile;
 material.onBeforeCompile=shader=>{
  if(previous)previous(shader);
  shader.uniforms.waterMotionTime=phase;
  shader.uniforms.waterMotionStrength=strength;
  shader.uniforms.waterMotionMask={value:waterMotionMask};
  shader.fragmentShader='uniform float waterMotionTime;\nuniform float waterMotionStrength;\nuniform sampler2D waterMotionMask;\n'+shader.fragmentShader;
  // Water is composed with foliage inside the same map sample when both effects are active.
  const waterCode=`
  float waterCoverage = smoothstep(0.02,0.28,texture2D(waterMotionMask,vMapUv).a);
  float wt = waterMotionTime;
  float waves = sin(vMapUv.y * ${kind===1?'120.0':'75.0'} + wt * ${kind===1?'3.4':'1.8'} + sin(vMapUv.x*35.0+wt)*0.7);
  float ripples = sin(vMapUv.x*165.0+wt*2.1)*cos(vMapUv.y*145.0-wt*1.4);
  vec2 flowDirection = vec2(cos(${direction.toFixed(6)}),sin(${direction.toFixed(6)}));
  vec2 waterShift = vec2(waves*0.0025+ripples*0.0008,ripples*0.0013);
  ${kind===1?'waterShift += vec2(sin(vMapUv.y*52.0+wt*2.5)*0.003,cos(vMapUv.x*30.0-wt)*0.001);':''}
  ${kind===2?'waterShift += flowDirection * (0.003*sin(wt*1.8+vMapUv.y*100.0));':''}
  ${kind===3?'waterShift += vec2(ripples*0.001,0.005*sin(wt*2.5+vMapUv.y*90.0));':''}
  ${kind===4?'waterShift *= 0.45;':''}
  waterShift *= waterCoverage * waterMotionStrength;
  `;
  // Inject before the foliage map sample when present; otherwise replace standard map chunk.
  if(shader.fragmentShader.includes('vec4 sampledDiffuseColor = texture2D(map,windUv);')){
   shader.fragmentShader=shader.fragmentShader.replace('vec4 sampledDiffuseColor = texture2D(map,windUv);',waterCode+'\n  windUv += waterShift;\n  vec4 sampledDiffuseColor = texture2D(map,windUv);');
  }else{
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
   vec2 waterUv=vMapUv;
   ${waterCode}
   waterUv+=waterShift;
   diffuseColor*=texture2D(map,waterUv);
   #endif`);
  }
 };
 const prevKey=material.customProgramCacheKey?.bind(material);
 material.customProgramCacheKey=()=> (prevKey?prevKey():'minivr-water')+'-water-v1-'+kind+'-'+direction.toFixed(4);
 microMotionMaterials.push({material,phase,speed});
}
function makeHybridDepthGroups(source){
 const count=Math.max(2,Math.min(10,Number(effectSettings.parallaxGroups)||5));
 const image=source.image;if(!image?.width||!image?.height)return false;
 const maxTextureSize=renderer.capabilities.maxTextureSize||4096;
 const sourceWidth=image.naturalWidth||image.videoWidth||image.width,sourceHeight=image.naturalHeight||image.videoHeight||image.height;
 const scale=Math.min(1,maxTextureSize/sourceWidth,maxTextureSize/sourceHeight,4096/sourceWidth);
 const w=Math.max(2,Math.round(sourceWidth*scale/2)*2),h=Math.max(1,Math.round(sourceHeight*scale));
 const base=document.createElement('canvas');base.width=w;base.height=h;
 const baseCtx=base.getContext('2d',{willReadFrequently:true});baseCtx.drawImage(image,0,0,w,h);
 const original=baseCtx.getImageData(0,0,w,h).data;
 foliageWindMask=null;
 if(effectSettings.parallaxMicroMotion!==false){
  if(manualFoliageMaskImage){const maskCanvas=document.createElement('canvas');maskCanvas.width=512;maskCanvas.height=256;const maskCtx=maskCanvas.getContext('2d');maskCtx.drawImage(manualFoliageMaskImage,0,0,512,256);foliageWindMask=new THREE.CanvasTexture(maskCanvas);foliageWindMask.wrapS=THREE.RepeatWrapping;foliageWindMask.minFilter=THREE.LinearFilter;}
  else foliageWindMask=makeFoliageWindMask(original,w,h);
 }
 waterMotionMask=null;
 if(manualWaterMaskImage){const maskCanvas=document.createElement('canvas');maskCanvas.width=512;maskCanvas.height=256;maskCanvas.getContext('2d').drawImage(manualWaterMaskImage,0,0,512,256);waterMotionMask=new THREE.CanvasTexture(maskCanvas);waterMotionMask.wrapS=THREE.RepeatWrapping;waterMotionMask.minFilter=THREE.LinearFilter;}
 const depth=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)depth[y*w+x]=remapParallaxDepth(sampleDepthBilinear((x+.5)/w,1-(y+.5)/h));
 for(let band=0;band<count;band++){
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d'),frame=ctx.createImageData(w,h),pixels=frame.data;
  const center=(band+.5)/count,halfWidth=1/count;
  const occlusion=effectSettings.parallaxDynamicOcclusion===true
   ?THREE.MathUtils.clamp(Number(effectSettings.parallaxOcclusionStrength??50),0,100)/100:0;
  for(let i=0;i<depth.length;i++){
   const distance=Math.abs(depth[i]-center);
   const weight=Math.max(0,Math.min(1,(halfWidth-distance)/(.5/count)));
   if(weight<=0)continue;
   // Sharper coverage on near bands gives them a more definite silhouette,
   // while retaining a feathered transition at depth boundaries.
   const foreground=band/(count-1);
   const edgePower=1+occlusion*foreground*2.2;
   const coverage=occlusion>0?Math.pow(weight,edgePower):weight;
   const j=i*4;pixels[j]=original[j];pixels[j+1]=original[j+1];pixels[j+2]=original[j+2];
   pixels[j+3]=Math.round(255*coverage);
  }
  ctx.putImageData(frame,0,0);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const geo=geometry();
  if(occlusion>0){
   // Shift each band to a progressively closer shell. Foreground silhouettes
   // occlude more of the distant bands during existing camera parallax.
   const pos=geo.getAttribute('position');
   const nearBias=occlusion*(band/(count-1))*1.8;
   for(let k=0;k<pos.count;k++){
    const x=pos.getX(k),y=pos.getY(k),z=pos.getZ(k);
    const radius=Math.hypot(x,y,z)||1;
    const factor=Math.max(.85,(radius-nearBias)/radius);
    pos.setXYZ(k,x*factor,y*factor,z*factor);
   }
   pos.needsUpdate=true;geo.computeBoundingSphere();
  }
  
  if(effectSettings.mirrorHorizontal){const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,transparent:true,depthWrite:false,alphaTest:.015});
  installMicroMotion(material,band,count);
  installWaterMotion(material);
  const mesh=new THREE.Mesh(geo,material);mesh.layers.set(0);mesh.renderOrder=band;
  scene.add(mesh);hybridMeshes.push(mesh);
 }
 return true;
}
function installPanorama(source){
 source.colorSpace=THREE.SRGBColorSpace;
 installAiBackground();
 const previous=[...new Set([leftMesh,rightMesh].filter(Boolean))];
 clearHybridMeshes();
 if(depthBackgroundMesh){scene.remove(depthBackgroundMesh);depthBackgroundMesh.geometry.dispose();depthBackgroundMesh.material.map?.dispose();depthBackgroundMesh.material.dispose();depthBackgroundMesh=null;}
 if(projection==='360'&&stereoMode==='mono'&&parallaxDepthPixels&&!effectSettings.parallaxBackground){depthBackgroundMesh=makeDepthBackground(source);if(depthBackgroundMesh)scene.add(depthBackgroundMesh);}
 if(stereoMode==='mono'){
  const hybrid=projection==='360'&&parallaxDepthPixels&&effectSettings.parallaxEnabled&&effectSettings.parallaxMode==='hybrid'&&makeHybridDepthGroups(source);
  if(hybrid){
   // Keep the original at the far radius to cover disocclusions between bands.
   const geo=new THREE.SphereGeometry(80,96,48);
   if(effectSettings.mirrorHorizontal){const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}
   const backdrop=new THREE.Mesh(geo,new THREE.MeshBasicMaterial({map:source,side:THREE.BackSide,depthWrite:false}));
   backdrop.layers.set(0);backdrop.renderOrder=-20;scene.add(backdrop);leftMesh=rightMesh=backdrop;
  }else{
  const g=geometry(sourceAspect(source));if(effectSettings.mirrorHorizontal){const uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}const mesh=new THREE.Mesh(g,new THREE.MeshBasicMaterial({map:source,side:projection==='flat'?THREE.FrontSide:THREE.BackSide}));
  if(projection==='flat'){mesh.position.set(3.2,0,0);mesh.rotation.y=-Math.PI/2;}else if(projection==='180')mesh.rotation.y=Math.PI/2;
  mesh.layers.set(0);scene.add(mesh);leftMesh=rightMesh=mesh;
  }
 }else{leftMesh=makeEye(source,'left');rightMesh=makeEye(source,'right');source.dispose()}
 for(const mesh of previous){scene.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose()}
 if(getViewerMode()===ViewerMode.DESKTOP){if(stereoMode==='mono')camera.layers.set(0);else desktopEye()}
 requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.remove('scene-loading')));
}
let tiledPanorama=null;
async function loadInitialPanorama(){
 await Promise.all([loadParallaxDepth(),loadManualFoliageMask(),loadManualWaterMask()]);
 if(projection==='360'&&stereoMode==='mono'&&root.dataset.tiles&&!parallaxDepthPixels){
  try{
   tiledPanorama=await createTiledPanorama({url:root.dataset.tiles,scene,camera,renderer,mirror:!!effectSettings.mirrorHorizontal});
   document.body.classList.remove('scene-loading');return;
  }catch(err){console.warn('Tile mode unavailable; falling back to original image',err)}
 }
 new THREE.TextureLoader().load(root.dataset.image,installPanorama,undefined,err=>{console.error('Scene texture load failed',err);document.querySelector('#loader span').textContent='SCENE LOAD ERROR';});
}
loadInitialPanorama();

function desktopEye(){camera.layers.enable(0);camera.layers.enable(1);camera.layers.disable(2)}
if(stereoMode==='mono'){camera.layers.set(0)}else desktopEye();
const hud=new THREE.Group(),interactive=[];scene.add(camera);scene.add(hud);hud.layers.enableAll();
function roundedRectShape(w,h,r){const s=new THREE.Shape();s.moveTo(r,0);s.lineTo(w-r,0);s.quadraticCurveTo(w,0,w,r);s.lineTo(w,h-r);s.quadraticCurveTo(w,h,w-r,h);s.lineTo(r,h);s.quadraticCurveTo(0,h,0,h-r);s.lineTo(0,r);s.quadraticCurveTo(0,0,r,0);return s}
const panelW=2.6,panelH=.42,panelGeo=new THREE.ShapeGeometry(roundedRectShape(panelW,panelH,.08));panelGeo.translate(-panelW/2,-panelH/2,0);
const panel=new THREE.Mesh(panelGeo,new THREE.MeshBasicMaterial({color:0x1a1a1a,opacity:0,transparent:true,side:THREE.DoubleSide,depthTest:false}));panel.position.set(0,0,-1.5);panel.renderOrder=100;hud.add(panel);
const panelBorderGeo=new THREE.ShapeGeometry(roundedRectShape(panelW+.02,panelH+.02,.09));panelBorderGeo.translate(-(panelW+.02)/2,-(panelH+.02)/2,0);const panelBorder=new THREE.Mesh(panelBorderGeo,new THREE.MeshBasicMaterial({color:0xffffff,opacity:0,transparent:true,side:THREE.DoubleSide,depthTest:false}));panelBorder.position.z=-.001;panel.add(panelBorder);
function hudButton(label,x,type,action,base=0x2a2a2a,hover=0x444444){const g=new THREE.Group(),m=new THREE.Mesh(new THREE.CircleGeometry(.08,32),new THREE.MeshBasicMaterial({color:base,opacity:.9,transparent:true,depthTest:false}));m.userData={interactive:true,type,action,baseColor:base,hoverColor:hover};g.add(m);const ring=new THREE.Mesh(new THREE.RingGeometry(.078,.082,32),new THREE.MeshBasicMaterial({color:0xffffff,opacity:.15,transparent:true,depthTest:false}));ring.position.z=.001;g.add(ring);const cv=document.createElement('canvas');cv.width=cv.height=64;const c=cv.getContext('2d');c.fillStyle='#fff';c.font='40px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(label,32,32);const lm=new THREE.Mesh(new THREE.PlaneGeometry(.1,.1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));lm.position.z=.002;g.add(lm);g.position.set(x,0,.01);g.renderOrder=125;panel.add(g);interactive.push(m);return g}
function goScene(i){const s=tourData.scenes[i];if(s)navigate('/viewer.php?id='+s.panorama_id+'&tour='+tour+'&scene='+s.id+(immersiveLaunch?'&immersive=1':''))}
async function exitViewer(){if(renderer.xr.isPresenting){const session=renderer.xr.getSession();if(session)await session.end()}if(legacyCardboard&&legacyVRDisplay){try{await legacyVREffect.exitPresent()}catch{}}navigate(backUrl)}
const menuGroup=new THREE.Group(),infoGroup=new THREE.Group(),contentGroup=new THREE.Group();hud.add(menuGroup,infoGroup,contentGroup);menuGroup.visible=infoGroup.visible=contentGroup.visible=false;
function closePanels(except=null){if(except!==menuGroup)menuGroup.visible=false;if(except!==infoGroup)infoGroup.visible=false;if(except!==contentGroup){contentGroup.visible=false;clearGroup(contentGroup)}menuOpen=menuGroup.visible}
let menuOpen=false,menuPage=Math.max(0,Math.floor(Math.max(0,tourData.current)/6));
hudButton('✕',-.72,'exit-vr',()=>exitViewer(),0x2a2a2a,0xff3366);hudButton('⊞',-.48,'gallery',()=>{const show=!menuGroup.visible;closePanels(show?menuGroup:null);menuGroup.visible=show;menuOpen=show;if(show)buildMenu()});hudButton('⏮',-.24,'previous',()=>goScene(tourData.current-1));hudButton('⏭',0,'next',()=>goScene(tourData.current+1));hudButton('⟲',.24,'reset-orientation',()=>{lon=0;lat=0});hudButton('i',.48,'info',()=>{const show=!infoGroup.visible;closePanels(show?infoGroup:null);infoGroup.visible=show});hudButton('⌂',.72,'home',()=>navigate('/'));
{const cv=document.createElement('canvas');cv.width=900;cv.height=420;const c=cv.getContext('2d');c.fillStyle='#041923f2';c.fillRect(0,0,900,420);c.strokeStyle='#55e9f8';c.lineWidth=5;c.strokeRect(4,4,892,412);c.fillStyle='#70efff';c.font='bold 25px monospace';c.fillText('SCENE INFO',40,55);c.fillStyle='#fff';c.font='bold 42px sans-serif';c.fillText((tourData.title||'').slice(0,34),40,115);c.font='25px sans-serif';const words=(tourData.description||'Нет описания').split(' ');let line='',y=170;for(const w of words){const test=line+w+' ';if(c.measureText(test).width>800){c.fillText(line,40,y);line=w+' ';y+=38}else line=test;if(y>370)break}c.fillText(line,40,y);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(4.2,1.96,1);sp.position.set(0,.25,-3);sp.renderOrder=120;infoGroup.add(sp)}
function clearGroup(g){for(const o of [...g.children]){g.remove(o);const k=interactive.indexOf(o);if(k>=0)interactive.splice(k,1);o.material?.map?.dispose?.();o.material?.dispose?.()}}
let menuBuildId=0;
function sceneCard(s,index,x,y,buildId){const cv=document.createElement('canvas');cv.width=640;cv.height=360;const c=cv.getContext('2d');c.fillStyle=index===tourData.current?'#0c5865':'#061923';c.fillRect(0,0,640,360);c.strokeStyle=index===tourData.current?'#91f8ff':'#2f8a99';c.lineWidth=index===tourData.current?8:4;c.strokeRect(4,4,632,352);c.fillStyle='#6cefff';c.font='bold 22px monospace';c.fillText('SCENE '+String(index+1).padStart(2,'0'),26,42);c.fillStyle='#efffff';c.font='bold 31px sans-serif';let title=(s.title||'Сцена');if(title.length>28)title=title.slice(0,27)+'…';c.fillText(title,26,295);c.fillStyle='#6e929d';c.font='20px monospace';c.fillText(index===tourData.current?'CURRENT':'OPEN →',26,330);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(1.82,1.02,1);sp.position.set(x,y,-3.2);sp.userData.action=()=>goScene(index);sp.renderOrder=120;menuGroup.add(sp);interactive.push(sp);if(s.preview||s.image){new THREE.TextureLoader().load(s.preview||s.image,t=>{if(buildId!==menuBuildId){t.dispose();return}t.colorSpace=THREE.SRGBColorSpace;const pic=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false}));pic.scale.set(1.65,.62,1);pic.position.set(x,y+.13,-3.18);pic.renderOrder=121;pic.userData.action=()=>goScene(index);menuGroup.add(pic);interactive.push(pic)})}}
function galleryButton(label,x,y,action,type='gallery-control'){const g=new THREE.Group(),m=new THREE.Mesh(new THREE.CircleGeometry(.12,32),new THREE.MeshBasicMaterial({color:0x2a2a2a,opacity:.92,transparent:true,depthTest:false}));m.userData={interactive:true,type,action,baseColor:0x2a2a2a,hoverColor:0x444444};g.add(m);const ring=new THREE.Mesh(new THREE.RingGeometry(.116,.123,32),new THREE.MeshBasicMaterial({color:0xffffff,opacity:.15,transparent:true,depthTest:false}));ring.position.z=.001;g.add(ring);const cv=document.createElement('canvas');cv.width=cv.height=64;const c=cv.getContext('2d');c.fillStyle='#fff';c.font='36px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(label,32,32);const lm=new THREE.Mesh(new THREE.PlaneGeometry(.14,.14),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));lm.position.z=.002;g.add(lm);g.position.set(x,y,-3.12);g.renderOrder=126;menuGroup.add(g);interactive.push(m);return g}
function buildMenu(){const buildId=++menuBuildId;clearGroup(menuGroup);const pages=Math.max(1,Math.ceil(tourData.scenes.length/6));menuPage=Math.max(0,Math.min(menuPage,pages-1));const start=menuPage*6;tourData.scenes.slice(start,start+6).forEach((s,k)=>sceneCard(s,start+k,(k%3-1)*1.95,1.05-Math.floor(k/3)*1.15,buildId));galleryButton('‹',-1.55,-1.28,()=>{if(menuPage>0){menuPage--;buildMenu()}},'gallery-prev');galleryButton('›',1.55,-1.28,()=>{if(menuPage<pages-1){menuPage++;buildMenu()}},'gallery-next');galleryButton('✕',0,-1.68,()=>{menuGroup.visible=false;menuOpen=false},'gallery-close')}
buildMenu();hud.visible=false;
const hotspotObjects=[];let activeHotspot=null;
function markerTexture(h,active=false){const cv=document.createElement('canvas');cv.width=512;cv.height=512;const c=cv.getContext('2d');c.clearRect(0,0,512,512);if(h.type==='scene'){const glow=c.createRadialGradient(256,256,40,256,256,205);glow.addColorStop(0,active?'#6fffff88':'#35eaff55');glow.addColorStop(.52,'#083c4c88');glow.addColorStop(.7,'#07141c33');glow.addColorStop(1,'#0000');c.fillStyle=glow;c.fillRect(0,0,512,512);for(let i=0;i<3;i++){c.beginPath();c.ellipse(256,256,118+i*22,184+i*9,0,0,Math.PI*2);c.lineWidth=active?12-i*2:8-i;c.strokeStyle=i===0?'#c9ffff':i===1?'#55ecff':'#1a8298';c.globalAlpha=1-i*.22;c.stroke()}c.globalAlpha=1;c.beginPath();c.moveTo(220,256);c.lineTo(292,256);c.moveTo(272,232);c.lineTo(296,256);c.lineTo(272,280);c.lineWidth=9;c.lineCap='round';c.strokeStyle='#eaffff';c.stroke()}else{c.beginPath();c.arc(256,256,150,0,Math.PI*2);c.fillStyle=active?'#29ddec':'#052530dd';c.fill();c.lineWidth=active?18:11;c.strokeStyle='#72f5ff';c.stroke();c.fillStyle='#eaffff';c.textAlign='center';c.textBaseline='middle';c.font='bold 142px sans-serif';c.fillText(h.type==='info'?'i':'▣',256,266)}return new THREE.CanvasTexture(cv)}
function hotspotSprite(h){
 const yaw=THREE.MathUtils.degToRad(Number(h.yaw)),pitch=THREE.MathUtils.degToRad(Number(h.pitch)),rad=110;
 const pos=new THREE.Vector3(rad*Math.cos(pitch)*Math.cos(yaw),rad*Math.sin(pitch),rad*Math.cos(pitch)*Math.sin(yaw));
 if(h.type==='scene'){
  const portal=new THREE.Group();portal.position.copy(pos);portal.lookAt(0,0,0);portal.userData=h;portal.userData.baseScale=1;
  const outer=new THREE.Mesh(new THREE.TorusGeometry(8.8,1.05,20,64),new THREE.MeshBasicMaterial({color:0x50efff,transparent:true,opacity:.9,depthTest:false}));
  const inner=new THREE.Mesh(new THREE.TorusGeometry(7.25,.35,16,64),new THREE.MeshBasicMaterial({color:0xd9ffff,transparent:true,opacity:.82,depthTest:false}));
  const surface=new THREE.Mesh(new THREE.CircleGeometry(7.05,64),new THREE.MeshBasicMaterial({color:0x073a4b,transparent:true,opacity:.62,side:THREE.DoubleSide,depthTest:false}));surface.position.z=.08;
  const hit=new THREE.Mesh(new THREE.CircleGeometry(9.8,48),new THREE.MeshBasicMaterial({transparent:true,opacity:0,side:THREE.DoubleSide,depthTest:false}));hit.position.z=.16;hit.userData=h;hit.userData.portal=portal;
  portal.add(outer,inner,surface,hit);portal.layers.enableAll();portal.traverse(o=>o.layers.enableAll());scene.add(portal);hotspotObjects.push(hit);
  const target=tourData.scenes.find(s=>Number(s.id)===Number(h.target_scene_id));if(target?.preview||target?.image)new THREE.TextureLoader().load(target.preview||target.image,t=>{t.colorSpace=THREE.SRGBColorSpace;surface.material.map=t;surface.material.color.set(0xffffff);surface.material.opacity=.9;surface.material.needsUpdate=true});
  const cv=document.createElement('canvas');cv.width=768;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#03151ddd';c.fillRect(0,0,768,128);c.strokeStyle='#5cefff';c.lineWidth=4;c.strokeRect(3,3,762,122);c.fillStyle='#eaffff';c.textAlign='center';c.font='bold 34px sans-serif';c.fillText((h.label||target?.title||'Перейти').slice(0,34),384,78);const label=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));label.scale.set(15,2.5,1);label.position.set(0,-12,.3);portal.add(label);
  portal.userData.animate=(time,active)=>{const s=active?1.14:1;portal.scale.lerp(new THREE.Vector3(s,s,s),.12);outer.rotation.z=time*.00025;inner.rotation.z=-time*.0004;outer.material.opacity=active?1:.82;surface.material.opacity=active ? .98 : (surface.material.map ? .8 : .62)};
 }else{
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture(h),transparent:true,depthTest:false}));const base=11;sp.scale.set(base,base,1);sp.position.copy(pos);sp.userData=h;sp.userData.baseScale=base;sp.layers.enableAll();scene.add(sp);hotspotObjects.push(sp)
 }
}
hotspotData.forEach(hotspotSprite);
function actionSprite(label,x,action,parent,y=-1.62,z=-3.02,width=1.15){
 const cv=document.createElement('canvas');cv.width=512;cv.height=144;const c=cv.getContext('2d');
 c.fillStyle='#124554';c.fillRect(0,0,512,144);c.strokeStyle='#76efff';c.lineWidth=7;c.strokeRect(4,4,504,136);
 c.fillStyle='#fff';c.font='bold 52px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(label,256,72);
 const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));
 sp.position.set(x,y,z);sp.scale.set(width,.36,1);sp.renderOrder=140;sp.userData.action=action;sp.layers.enableAll();parent.add(sp);interactive.push(sp);return sp;
}
function contentPanel(h){closePanels(contentGroup);clearGroup(contentGroup);contentGroup.visible=true;
 const head=document.createElement('canvas');head.width=1000;head.height=190;const c=head.getContext('2d');c.fillStyle='#031720f4';c.fillRect(0,0,1000,190);c.strokeStyle='#5cecff';c.lineWidth=6;c.strokeRect(5,5,990,185);c.fillStyle='#65efff';c.font='bold 24px monospace';c.fillText(h.type==='image'?'IMAGE':'INFORMATION',42,48);c.fillStyle='#fff';c.font='bold 43px sans-serif';c.fillText((h.label||'').slice(0,36),42,118);
 const hs=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(head),transparent:true,depthTest:false}));hs.scale.set(4.3,.82,1);hs.position.set(0,1.12,-3.08);hs.renderOrder=132;contentGroup.add(hs);
 if(h.type==='image'&&h.content){new THREE.TextureLoader().load(h.content,t=>{if(!contentGroup.visible)return;t.colorSpace=THREE.SRGBColorSpace;const im=t.image||{},aspect=im.width&&im.height?im.width/im.height:16/9,maxW=4.15,maxH=2.25;let w=maxW,hg=w/aspect;if(hg>maxH){hg=maxH;w=hg*aspect}const pic=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false}));pic.scale.set(w,hg,1);pic.position.set(0,-.18,-3.04);pic.renderOrder=131;contentGroup.add(pic)},undefined,()=>addInfoText('Не удалось загрузить изображение'))}
 else addInfoText(h.content||'Нет информации');
 actionSprite('CLOSE',0,()=>{contentGroup.visible=false;clearGroup(contentGroup)},contentGroup,-1.62,-3.02,1.15);
 function addInfoText(text){const cv=document.createElement('canvas');cv.width=1000;cv.height=560;const x=cv.getContext('2d');x.fillStyle='#031720f4';x.fillRect(0,0,1000,560);x.strokeStyle='#5cecff';x.lineWidth=5;x.strokeRect(4,4,992,552);x.fillStyle='#e9ffff';x.font='28px sans-serif';const words=String(text).split(' ');let line='',y=60;for(const w of words){const test=line+w+' ';if(x.measureText(test).width>890){x.fillText(line,45,y);line=w+' ';y+=43}else line=test;if(y>500)break}x.fillText(line,45,y);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(4.3,2.4,1);sp.position.set(0,-.12,-3.04);sp.renderOrder=131;contentGroup.add(sp)}
}
const raycaster=new THREE.Raycaster();let gazeTarget=null,gazeStart=0;
const gazeCursor=new THREE.Group();const gazeBase=new THREE.Mesh(new THREE.RingGeometry(.018,.025,48),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.72,depthTest:false}));const gazeProgress=new THREE.Mesh(new THREE.RingGeometry(.028,.034,48,1,Math.PI/2,0.001),new THREE.MeshBasicMaterial({color:0x66f4ff,transparent:true,opacity:.95,depthTest:false}));gazeBase.renderOrder=gazeProgress.renderOrder=200;gazeCursor.add(gazeBase,gazeProgress);gazeCursor.position.set(0,0,-1.25);gazeCursor.visible=false;camera.add(gazeCursor);
function updateGazeCursor(hit,progress){gazeCursor.visible=false;gazeProgress.geometry.dispose();gazeProgress.geometry=new THREE.RingGeometry(.028,.034,48,1,Math.PI/2,Math.max(.001,Math.PI*2*progress));gazeBase.material.color.setHex(hit?0x66f4ff:0xffffff)}const pickables=()=>[...hotspotObjects,...interactive.filter(o=>o.visible&&o.parent?.visible!==false)];
function activate(o){if(o?.userData?.action)return o.userData.action();const h=o?.userData;if(!h)return;if(h.type==='scene'&&h.target_panorama_id)return navigate('/viewer.php?id='+h.target_panorama_id+'&tour='+tour+'&scene='+h.target_scene_id);if(h.type==='info'||h.type==='image'){contentPanel(h);const modal=document.querySelector('#hotspot-modal');document.querySelector('#hotspot-modal-type').textContent=h.type==='image'?'ИЗОБРАЖЕНИЕ':'ИНФОРМАЦИЯ';document.querySelector('#hotspot-modal-title').textContent=h.label||'';const box=document.querySelector('#hotspot-modal-content');box.innerHTML=h.type==='image'&&h.content?'<img alt="">':'';if(h.type==='image'&&h.content)box.querySelector('img').src=h.content;else box.textContent=h.content||'';if(!cardboard&&!renderer.xr.isPresenting)modal.classList.add('open')}}
document.querySelector('#hotspot-close').onclick=()=>document.querySelector('#hotspot-modal').classList.remove('open');
for(let i=0;i<2;i++){const ctl=renderer.xr.getController(i);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0x66eeff}));line.scale.z=4;ctl.add(line);ctl.addEventListener('select',()=>{raycaster.setFromXRController(ctl);activate(raycaster.intersectObjects(pickables(),false)[0]?.object)});scene.add(ctl)}

// Desktop wheel and mobile two-finger pinch zoom (perspective FOV, no texture resampling).
const zoomMin=30,zoomMax=95,activeTouches=new Map();
let pinchDistance=0,pinchFov=75;
const canZoom=()=>!cardboard&&!legacyCardboard&&!renderer.xr.isPresenting;
function setZoom(fov){if(!canZoom())return;camera.fov=THREE.MathUtils.clamp(fov,zoomMin,zoomMax);camera.updateProjectionMatrix();}
renderer.domElement.style.touchAction='none';
renderer.domElement.addEventListener('wheel',e=>{if(!canZoom())return;e.preventDefault();setZoom(camera.fov+Math.sign(e.deltaY)*Math.min(9,Math.abs(e.deltaY)*.035));},{passive:false});
renderer.domElement.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;activeTouches.set(e.pointerId,[e.clientX,e.clientY]);if(activeTouches.size===2){const [a,b]=[...activeTouches.values()];pinchDistance=Math.hypot(a[0]-b[0],a[1]-b[1]);pinchFov=camera.fov;down=false;moved=true;}});
renderer.domElement.addEventListener('pointermove',e=>{if(!activeTouches.has(e.pointerId))return;activeTouches.set(e.pointerId,[e.clientX,e.clientY]);if(activeTouches.size===2&&pinchDistance>0){const [a,b]=[...activeTouches.values()],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);if(distance>0)setZoom(pinchFov*pinchDistance/distance);down=false;moved=true;}});
const releaseTouch=e=>{activeTouches.delete(e.pointerId);if(activeTouches.size<2)pinchDistance=0;};
renderer.domElement.addEventListener('pointerup',releaseTouch);
renderer.domElement.addEventListener('pointercancel',releaseTouch);
let moved=false;renderer.domElement.addEventListener('pointerdown',e=>{down=true;moved=false;x0=e.clientX;y0=e.clientY;lon0=lon;lat0=lat});
addEventListener('pointerup',e=>{if(down&&!moved&&activeTouches.size<2&&!cardboard&&!renderer.xr.isPresenting){const r=renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(p,camera);activate(raycaster.intersectObjects(hotspotObjects,false)[0]?.object)}down=false});addEventListener('pointermove',e=>{if(down&&(Math.abs(e.clientX-x0)>5||Math.abs(e.clientY-y0)>5))moved=true;if(down&&activeTouches.size<2&&!orientation){lon=lon0+(x0-e.clientX)*.12;lat=Math.max(-85,Math.min(85,lat0+(e.clientY-y0)*.12))}});


function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
document.querySelector('#gyro').onclick=async()=>{if(typeof DeviceOrientationEvent?.requestPermission==='function'&&(await DeviceOrientationEvent.requestPermission())!=='granted')return;orientation=!orientation;deviceOrientation.enabled=orientation};
document.querySelector('#full').onclick=()=>document.documentElement.requestFullscreen?.();
const vrControl=document.querySelector('#vr');vrControl.textContent='ENTER VR';let xrSession=null;
async function startImmersiveVR(){
 if(cardboard||renderer.xr.isPresenting)return;
 if(!navigator.xr){await toggleCardboard();return}
 try{
  const supported=await navigator.xr.isSessionSupported?.('immersive-vr');
  if(!supported){await toggleCardboard();return}
  xrSession=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor','hand-tracking']});
  xrSession.addEventListener('end',()=>{xrSession=null},{once:true});
  await renderer.xr.setSession(xrSession);
 }catch(err){
  console.warn('WebXR immersive-vr failed; using Cardboard fallback',err);
  if(!renderer.xr.isPresenting)await toggleCardboard();
 }
}
vrControl.onclick=startImmersiveVR;

function updateCardboardEyes(){
 // A wider, but bounded, stereo baseline is useful for the depth-derived shell.
 // Physical eye separation remains comfortable; depth-derived geometry supplies
 // the parallax, rather than exaggerating stereo disparity at 75% strength.
 cardboardStereo.eyeSep=.064;
 const size=renderer.getDrawingBufferSize(new THREE.Vector2()),half=Math.max(1,Math.floor(size.x/2));
 camera.aspect=half/Math.max(1,size.y);camera.updateProjectionMatrix();camera.updateMatrixWorld(true);cardboardStereo.aspect=.5;cardboardStereo.update(camera);
 const l=cardboardStereo.cameraL,r=cardboardStereo.cameraR;
 if(stereoMode==='mono'){l.layers.set(0);r.layers.set(0)}else{l.layers.disableAll();l.layers.enable(0);l.layers.enable(1);r.layers.disableAll();r.layers.enable(0);r.layers.enable(2)}
 return {size,half,l,r};
}
function renderCardboard(){
 const {size,half,l,r}=updateCardboardEyes();
 const gl=renderer.getContext();
 renderer.setRenderTarget(null);renderer.autoClear=false;
 renderer.setScissorTest(true);
 gl.enable(gl.SCISSOR_TEST);
 gl.viewport(0,0,half,size.y);gl.scissor(0,0,half,size.y);gl.clearColor(0,0,0,1);gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);renderer.render(scene,l);
 gl.viewport(half,0,size.x-half,size.y);gl.scissor(half,0,size.x-half,size.y);gl.clear(gl.DEPTH_BUFFER_BIT);renderer.render(scene,r);
 gl.disable(gl.SCISSOR_TEST);renderer.setScissorTest(false);renderer.setViewport(0,0,size.x,size.y);renderer.autoClear=true;
}
const cardboardRestoreKey='minivr:cardboard:restore';
async function switchSceneInPlace(url){
 const response=await fetch(url,{credentials:'same-origin'});
 if(!response.ok)throw new Error('Scene HTTP '+response.status);
 const doc=new DOMParser().parseFromString(await response.text(),'text/html');
 const next=doc.querySelector('#viewer');
 if(!next)throw new Error('Scene data missing');
 const image=next.dataset.image;
 const texture=await new THREE.TextureLoader().loadAsync(image);
 projection=next.dataset.projection||'360';stereoMode=next.dataset.stereo||'mono';
 if(tiledPanorama){tiledPanorama.dispose();tiledPanorama=null;}
 installPanorama(texture);
 effectSystem?.dispose();atmosphereSystem?.dispose();moonSystem?.dispose();environmentSystem?.dispose();dayCycleStarted=null;dayGradeLast=-1;dayPhaseOverride=null;try{effectSettings=JSON.parse(next.dataset.effects||'{}');effectSettings.timeOfDay=false;effectSettings.dayCycle=false}catch(e){effectSettings={}}effectSystem=createPanoramaEffects(scene,effectSettings);atmosphereSystem=createAtmosphere(scene,effectSettings);moonSystem=createMoonlight(scene,effectSettings);environmentSystem=createEnvironment(scene,effectSettings);root.dataset.effects=next.dataset.effects||'{}';
 const nextTour=JSON.parse(doc.querySelector('#tour-data')?.textContent||'{}');
 tourData.current=nextTour.current??-1;
 resetTourTimer();
 window.dispatchEvent(new CustomEvent('minivr:scene-music',{detail:{trackId:Number(next.dataset.musicTrack||0)}}));
 hotspotData=JSON.parse(doc.querySelector('#hotspots-data')?.textContent||'[]');
 for(const obj of hotspotObjects){scene.remove(obj);obj.material.map?.dispose();obj.material.dispose()}
 hotspotObjects.length=0;activeHotspot=null;
 hotspotData.forEach(hotspotSprite);
 closePanels();menuPage=Math.max(0,Math.floor(Math.max(0,tourData.current)/6));buildMenu();
 root.dataset.image=image;root.dataset.projection=projection;root.dataset.stereo=stereoMode;
 root.dataset.scene=next.dataset.scene;
 document.title=doc.title;
 const topTitle=doc.querySelector('#top b'),currentTitle=document.querySelector('#top b');
 if(topTitle&&currentTitle)currentTitle.textContent=topTitle.textContent;
 history.pushState({miniVRScene:true},'',url);
 cardboardMenuPlaced=false;
 if(getViewerMode()===ViewerMode.CARDBOARD)placeCardboardMenu();
}
function navigate(url){
 if(document.body.classList.contains('scene-leaving'))return;
 const target=new URL(url,location.href);
 if(getViewerMode()===ViewerMode.CARDBOARD&&target.origin===location.origin&&target.pathname==='/viewer.php'){
  switchSceneInPlace(target.pathname+target.search).catch(err=>console.error('In-place scene switch failed',err));
  return;
 }
 if(getViewerMode()===ViewerMode.CARDBOARD){
  try{sessionStorage.setItem(cardboardRestoreKey,JSON.stringify({path:new URL(url,location.href).pathname,expires:Date.now()+30000}))}catch{}
 }else{try{sessionStorage.removeItem(cardboardRestoreKey)}catch{}}
 document.body.classList.add('scene-leaving');
 setTimeout(()=>location.href=url,260)
}
async function restoreCardboardAfterNavigation(){
 let saved=null;
 try{saved=JSON.parse(sessionStorage.getItem(cardboardRestoreKey)||'null');sessionStorage.removeItem(cardboardRestoreKey)}catch{}
 if(!saved||saved.path!=='/viewer.php'||Date.now()>saved.expires)return;
 // Browsers may require a fresh gesture for fullscreen; stereo presentation itself is restored.
 await toggleCardboard();
}
async function toggleCardboard(){
 if(renderer.xr.isPresenting)return;
 if(legacyCardboard&&legacyVRDisplay){try{await legacyVREffect.exitPresent()}catch{}legacyCardboard=false;cardboard=false;hud.visible=false;cardboardMenu.visible=false;cardboardReticle.visible=false;cardboardMenuPlaced=false;document.body.classList.remove('cardboard');document.querySelector('#controls').style.display='';document.querySelector('#top').style.display='';resize();return}
 try{
  const displays=await navigator.getVRDisplays?.();
  legacyVRDisplay=displays?.[0]||null;
  if(legacyVRDisplay){
   legacyVREffect.setVRDisplay(legacyVRDisplay);legacyVRControls.setVRDisplay(legacyVRDisplay);legacyVREffect.setSize(innerWidth,innerHeight,false);
   await legacyVREffect.requestPresent();legacyCardboard=true;cardboard=false;orientation=false;deviceOrientation.enabled=false;deviceOrientation.disconnect();camera.layers.enable(0);camera.layers.enable(1);camera.layers.enable(2);hud.visible=false;gazeCursor.visible=false;cardboardMenuPlaced=false;placeCardboardMenu();document.body.classList.add('cardboard');document.querySelector('#controls').style.display='none';document.querySelector('#top').style.display='none';return;
  }
 }catch(err){console.warn('Legacy Cardboard requestPresent failed',err)}
 // Emergency fallback only when the polyfilled VRDisplay cannot present.
 if(typeof DeviceOrientationEvent?.requestPermission==='function'){try{if((await DeviceOrientationEvent.requestPermission())!=='granted')return}catch{return}}
 orientation=true;deviceOrientation.enabled=true;deviceOrientation.connect();cardboard=true;hud.visible=false;gazeCursor.visible=false;cardboardMenuPlaced=false;placeCardboardMenu();document.body.classList.add('cardboard');document.querySelector('#controls').style.display='none';document.querySelector('#top').style.display='none';try{await document.documentElement.requestFullscreen?.()}catch{}resize();
}
document.querySelector('#cardboard').onclick=toggleCardboard;
restoreCardboardAfterNavigation().catch(err=>console.warn('Cardboard restore failed',err));

// Cardboard gaze menu: world-locked, based on Ramotion vr-menu-demo focusFire pattern.
const cardboardMenu=new THREE.Group();cardboardMenu.visible=false;scene.add(cardboardMenu);const cardboardTargets=[];let cardboardFocus=null,cardboardFocusStart=0,cardboardMenuPlaced=false;
function cardboardLabel(text){const cv=document.createElement('canvas');cv.width=cv.height=128;const c=cv.getContext('2d');c.clearRect(0,0,128,128);c.fillStyle='#fff';c.font='bold 54px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(text,64,64);const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;return t}
function cardboardButton(label,x,action,type){const g=new THREE.Group();const target=new THREE.Mesh(new THREE.CircleGeometry(.18,40),new THREE.MeshBasicMaterial({color:0x0878d1,transparent:true,opacity:.82,side:THREE.DoubleSide}));target.userData={cardboardAction:action,type,baseScale:1};const icon=new THREE.Mesh(new THREE.PlaneGeometry(.22,.22),new THREE.MeshBasicMaterial({map:cardboardLabel(label),transparent:true,opacity:1,depthWrite:false,depthTest:false,alphaTest:.2,side:THREE.DoubleSide}));icon.position.z=.006;g.add(target,icon);g.position.set(x,0,0);cardboardMenu.add(g);cardboardTargets.push(target);return g}
cardboardButton('✕',-.9,()=>exitViewer(),'cb-exit');cardboardButton('‹',-.6,()=>goScene(tourData.current-1),'cb-prev');cardboardButton('⊞',-.3,()=>{menuGroup.visible=!menuGroup.visible;if(menuGroup.visible)buildMenu()},'cb-gallery');cardboardButton('i',0,()=>{infoGroup.visible=!infoGroup.visible},'cb-info');cardboardButton('⌂',.3,()=>navigate('/'),'cb-home');cardboardButton('›',.6,()=>goScene(tourData.current+1),'cb-next');cardboardButton('⟲',.9,()=>{lon=0;lat=0},'cb-reset');
const cardboardReticle=new THREE.Group();
const cbReticleBase=new THREE.Mesh(new THREE.CircleGeometry(.009,32),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.95,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
const cbReticleFuse=new THREE.Mesh(new THREE.RingGeometry(.014,.017,48,1,Math.PI/2,.001),new THREE.MeshBasicMaterial({color:0x00d8ff,transparent:true,opacity:.95,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
cbReticleBase.renderOrder=1500;cbReticleFuse.renderOrder=1501;
cardboardReticle.add(cbReticleBase,cbReticleFuse);
cardboardReticle.position.set(0,0,-1.2);
camera.add(cardboardReticle);
cardboardReticle.visible=false;
function placeCardboardMenu(){camera.updateMatrixWorld(true);const p=new THREE.Vector3(),q=new THREE.Quaternion(),dir=new THREE.Vector3(0,0,-1);camera.getWorldPosition(p);camera.getWorldQuaternion(q);dir.applyQuaternion(q);cardboardMenu.position.copy(p).add(dir.multiplyScalar(2.2));cardboardMenu.quaternion.copy(q);cardboardMenu.visible=true;cardboardMenuPlaced=true}
function updateCardboardGaze(){if(getViewerMode()!==ViewerMode.CARDBOARD){cardboardReticle.visible=false;return}if(!cardboardMenuPlaced)placeCardboardMenu();cardboardReticle.visible=true;camera.updateMatrixWorld(true);const origin=new THREE.Vector3(),direction=new THREE.Vector3();camera.getWorldPosition(origin);camera.getWorldDirection(direction);raycaster.set(origin,direction);const hit=raycaster.intersectObjects(cardboardTargets,false)[0]?.object||null;if(hit!==cardboardFocus){if(cardboardFocus){cardboardFocus.scale.setScalar(1);cardboardFocus.material.opacity=.82}cardboardFocus=hit;cardboardFocusStart=performance.now()}let p=0;if(hit){p=Math.max(0,Math.min(1,(performance.now()-cardboardFocusStart)/800));hit.scale.setScalar(1-.25*p);hit.material.opacity=.35+.47*(1-p);if(p>=1){cardboardFocusStart=performance.now()+999999;hit.userData.cardboardAction?.()}}cbReticleBase.material.color.setHex(hit?0x00d8ff:0xffffff);cbReticleFuse.geometry.dispose();cbReticleFuse.geometry=new THREE.RingGeometry(.014,.017,48,1,Math.PI/2,Math.max(.001,Math.PI*2*p))}
function updateGaze(){if(getViewerMode()!==ViewerMode.WEBXR)return;const xrCam=renderer.xr.getCamera(camera);const origin=new THREE.Vector3(),direction=new THREE.Vector3(0,0,-1);xrCam.getWorldPosition(origin);xrCam.getWorldDirection(direction);raycaster.set(origin,direction);const hit=raycaster.intersectObjects(pickables(),false)[0]?.object||null;const previous=gazeTarget;if(hit!==previous){if(previous&&hotspotObjects.includes(previous)&&!previous.userData.portal){previous.material.map.dispose();previous.material.map=markerTexture(previous.userData,false);previous.scale.setScalar(previous.userData.baseScale)}if(previous?.material?.color&&previous.userData?.interactive)previous.material.color.setHex(previous.userData.baseColor||0x2a2a2a);if(hit&&hotspotObjects.includes(hit)&&!hit.userData.portal){hit.material.map.dispose();hit.material.map=markerTexture(hit.userData,true);hit.scale.setScalar(hit.userData.baseScale*1.25)}gazeTarget=hit;gazeStart=performance.now();document.body.classList.remove('gazing')}if(hit){document.body.classList.add('gazing');const elapsed=performance.now()-gazeStart,progress=Math.min(1,elapsed/1200);document.documentElement.style.setProperty('--gaze',progress);updateGazeCursor(hit,progress);if(hit.material?.color&&hit.userData?.interactive)hit.material.color.setHex(hit.userData.hoverColor||0x444444);if(elapsed>1200){gazeStart=performance.now()+999999;activate(hit)}}else{document.body.classList.remove('gazing');document.documentElement.style.setProperty('--gaze',0);updateGazeCursor(null,0)}}
renderer.xr.addEventListener('sessionstart',()=>{camera.layers.enable(0);cardboard=false;cardboardDebug.visible=false;orientation=false;deviceOrientation.enabled=false;deviceOrientation.disconnect();document.body.classList.remove('cardboard');document.querySelector('#controls').style.display='none';document.querySelector('#top').style.display='none';hud.visible=true;xrDebug.visible=false;document.body.classList.add('xr-presenting')});
function syncXREyes(){
 if(!renderer.xr.isPresenting)return;
 const xrCam=renderer.xr.getCamera(camera);
 if(!xrCam?.cameras?.length)return;
 for(let i=0;i<xrCam.cameras.length;i++){
  const eye=xrCam.cameras[i];
  eye.layers.disableAll();eye.layers.enable(0);
  // The same depth-deformed 360° geometry is rendered independently from
  // each real XR eye pose; SBS/TB keep their dedicated per-eye textures.
  if(stereoMode!=='mono')eye.layers.enable(i===0?1:2);
 }
}renderer.xr.addEventListener('sessionend',()=>{xrDebug.visible=false;hud.visible=cardboard;document.body.classList.remove('xr-presenting');document.querySelector('#controls').style.display='';document.querySelector('#top').style.display=''});
renderer.domElement.addEventListener('pointermove',e=>{if(getViewerMode()!==ViewerMode.DESKTOP||down)return;const r=renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(p,camera);const hit=raycaster.intersectObjects(hotspotObjects,false)[0]?.object||null;hotspotObjects.forEach(o=>{const b=o.userData.baseScale||11,s=o===hit?b*1.23:b;o.scale.lerp(new THREE.Vector3(s,s,1),.18)});renderer.domElement.style.cursor=hit?'pointer':'grab'});
function syncXRDebug(){return;if(!renderer.xr.isPresenting)return;xrDebugCube.rotation.x+=.014;xrDebugCube.rotation.y+=.02}
function syncCardboardDebug(){return;if(!cardboard)return;camera.updateMatrixWorld(true);camera.getWorldPosition(cardboardDebug.position);camera.getWorldQuaternion(cardboardDebug.quaternion);debugCube.rotation.x+=.012;debugCube.rotation.y+=.018}
function placeHudInFront(){
 camera.updateMatrixWorld(true);camera.getWorldPosition(hud.position);camera.getWorldQuaternion(hud.quaternion);hud.scale.setScalar(1)
}
function syncHudPose(){
 const mode=getViewerMode();if(mode===ViewerMode.CARDBOARD)return;
 const head=mode===ViewerMode.WEBXR?renderer.xr.getCamera(camera):camera;
 head.updateMatrixWorld(true);head.getWorldPosition(hud.position);head.getWorldQuaternion(hud.quaternion);hud.scale.setScalar(1);
}
// Visible day/night grading on the actual panorama canvas, including tiled panoramas.
// Subtle desktop 2.5D movement; no positional offsets in device-orientation or VR modes.
const depthPointer=new THREE.Vector2();
const depthPointerSmooth=new THREE.Vector2();
const depthCameraOffset=new THREE.Vector3();
const depthLocalOffset=new THREE.Vector3();
const depthDesiredOffset=new THREE.Vector3();
let depthAutoPhase=0,depthAutoLastTime=0;
let depthMotionActive=false;
renderer.domElement.addEventListener('pointermove',event=>{
 const bounds=renderer.domElement.getBoundingClientRect();
 if(!bounds.width||!bounds.height)return;
 depthPointer.set(THREE.MathUtils.clamp((event.clientX-bounds.left)/bounds.width*2-1,-1,1),THREE.MathUtils.clamp(1-(event.clientY-bounds.top)/bounds.height*2,-1,1));
});
renderer.domElement.addEventListener('pointerleave',()=>depthPointer.set(0,0));
renderer.setAnimationLoop((time)=>{
 // GPU-side micro-motion for the nearest depth groups; no CPU texture updates.
 for(const entry of microMotionMaterials)entry.phase.value=time*.001*entry.speed;
 tiledPanorama?.update();
 effectSystem?.update(time,camera);atmosphereSystem?.update(time,camera);moonSystem?.update(time,camera);environmentSystem?.update(time,camera);
 if(getViewerMode()===ViewerMode.DESKTOP&&!down&&!orientation&&effectSettings.rotation){
  const dt=lastEffectTime?Math.min(.05,(time-lastEffectTime)/1000):0;
  lon+=dt*Math.max(0,Math.min(10,Number(effectSettings.rotationSpeed)||1));
 }
 lastEffectTime=time;
 const mode=getViewerMode();
 if(mode===ViewerMode.CARDBOARD&&cardboard){const canvas=renderer.domElement;canvas.style.position='fixed';canvas.style.inset='0';canvas.style.width='100vw';canvas.style.height='100dvh';canvas.style.zIndex='1'}
 if(mode===ViewerMode.CARDBOARD&&legacyCardboard){legacyVRControls.update();camera.updateMatrixWorld(true);hud.visible=false}
 syncHudPose();syncCardboardDebug();syncXRDebug();
 scene.traverse(o=>{if(o.userData?.animate)o.userData.animate(time,gazeTarget?.userData?.portal===o)});
 if(mode===ViewerMode.CARDBOARD&&orientation)deviceOrientation.update();
 // Update motion in view-relative coordinates: when the panorama rotates,
 // the apparent camera translation follows the viewing direction rather
 // than remaining pinned to the world X/Z axes.
 const motionDt=depthAutoLastTime?Math.min(.05,Math.max(0,(time-depthAutoLastTime)/1000)):1/60;
 depthAutoLastTime=time;
 if(mode===ViewerMode.DESKTOP&&!orientation){
  // Portrait phones need a stronger positional depth cue than desktop.
  // Keep landscape, tablets, Cardboard and WebXR unchanged.
  const portraitPhone=window.matchMedia('(orientation: portrait) and (pointer: coarse) and (max-width: 600px)').matches;
  const portraitBoost=portraitPhone?1.35:1;
  // Depth Window: optional stronger viewpoint translation, as if looking
  // through a nearby opening into the panorama. No synthetic camera motion in XR.
  const depthWindow=effectSettings.parallaxDepthWindow===true
   ?THREE.MathUtils.clamp(Number(effectSettings.parallaxDepthWindowStrength??50),0,100)/100:0;
  const windowBoost=1+depthWindow*.8;
  const amount=parallaxDepthPixels&&effectSettings.parallaxEnabled
   ? THREE.MathUtils.clamp(Number(effectSettings.parallaxStrength)||0,0,100)/100*portraitBoost*windowBoost:0;
  const autoEnabled=amount>0&&effectSettings.rotation&&effectSettings.parallaxAuto!==false;
  const autoAmplitude=THREE.MathUtils.clamp(Number(effectSettings.parallaxAutoAmplitude??35),0,100)/100;
  const autoSpeed=THREE.MathUtils.clamp(Number(effectSettings.parallaxAutoSpeed??.6),.1,3);
  if(autoEnabled)depthAutoPhase=(depthAutoPhase+motionDt*autoSpeed*2*Math.PI/8)%(Math.PI*2);
  const pointerDamping=1-Math.exp(-motionDt*7);
  depthPointerSmooth.lerp(depthPointer,pointerDamping);
  // Soft, elliptical translation with small vertical and forward components.
  // Avoid large head bobbing; foreground objects should move more than far ones.
  const sway=autoEnabled?amount*autoAmplitude:0;
  depthLocalOffset.set(
   depthPointerSmooth.x*amount*1.15+Math.sin(depthAutoPhase)*sway*.85,
   depthPointerSmooth.y*amount*(.55+depthWindow*.15)+Math.sin(depthAutoPhase*.65+.4)*sway*.18,
   Math.cos(depthAutoPhase)*sway*.2+depthWindow*amount*.12
  );
  const yaw=THREE.MathUtils.degToRad(lon);
  const cos=Math.cos(yaw),sin=Math.sin(yaw);
  depthDesiredOffset.set(
   depthLocalOffset.x*cos-depthLocalOffset.z*sin,
   depthLocalOffset.y,
   depthLocalOffset.x*sin+depthLocalOffset.z*cos
  );
  const damping=1-Math.exp(-motionDt*8);
  depthCameraOffset.lerp(depthDesiredOffset,damping);
  camera.position.copy(depthCameraOffset);
  depthMotionActive=true;
 }else if(depthMotionActive){
  // Never apply synthetic translation to tracked XR head poses or Cardboard.
  depthCameraOffset.set(0,0,0);depthPointerSmooth.set(0,0);
  if(mode===ViewerMode.CARDBOARD&&!legacyCardboard)camera.position.set(0,0,0);
  depthMotionActive=false;
 }
 if(mode===ViewerMode.DESKTOP&&!orientation){const phi=THREE.MathUtils.degToRad(90-lat),theta=THREE.MathUtils.degToRad(lon);camera.lookAt(500*Math.sin(phi)*Math.cos(theta),500*Math.cos(phi),500*Math.sin(phi)*Math.sin(theta))}
 if(mode===ViewerMode.WEBXR){syncXREyes();updateGaze();renderer.render(scene,camera);return}
 if(mode===ViewerMode.CARDBOARD){updateCardboardGaze();if(legacyCardboard)legacyVREffect.render(scene,camera);else renderCardboard();return}
 renderer.render(scene,camera);
});
setTimeout(()=>document.querySelector('#viewer-help')?.classList.add('hide'),4200);