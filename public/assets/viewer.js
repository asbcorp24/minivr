import {createTiledPanorama} from '/assets/tiled-panorama.js';
import * as THREE from '/assets/vendor/three/three.module.js';
import DeviceOrientationControls from '/assets/vendor/three/DeviceOrientationControls.js';
import VREffect from '/assets/vendor/three/effects/VREffect.js';
import VRControls from '/assets/vendor/three/controls/VRControls.js';

const root=document.querySelector('#viewer');
let projection=root.dataset.projection||'360', stereoMode=root.dataset.stereo||'mono';
const tour=Number(root.dataset.tour||0),backUrl=root.dataset.back||'/';let hotspotData=JSON.parse(document.querySelector('#hotspots-data')?.textContent||'[]');
const tourData=JSON.parse(document.querySelector('#tour-data')?.textContent||'{"scenes":[],"current":-1}');
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,1100);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.xr.enabled=true;root.appendChild(renderer.domElement);
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
function geometry(aspect=16/9){
 if(projection==='flat'){const h=2.7,w=h*aspect;return new THREE.PlaneGeometry(w,h)}
 if(projection==='180') return new THREE.SphereGeometry(500,64,40,0,Math.PI);
 return new THREE.SphereGeometry(500,64,40);
}
function sourceAspect(source){const im=source.image;if(!im?.width||!im?.height)return 16/9;let w=im.width,h=im.height;if(stereoMode==='sbs')w/=2;else if(stereoMode==='tb')h/=2;return w/h}
function makeEye(source,eye){
 const g=geometry(sourceAspect(source)),m=new THREE.MeshBasicMaterial({map:eyeTexture(source,eye),side:projection==='flat'?THREE.FrontSide:THREE.BackSide});
 const mesh=new THREE.Mesh(g,m);
 if(projection==='flat'){mesh.position.set(3.2,0,0);mesh.rotation.y=-Math.PI/2;}
 else if(projection==='180')mesh.rotation.y=Math.PI/2;
 mesh.layers.set(eye==='left'?1:2);scene.add(mesh);return mesh;
}
function installPanorama(source){
 source.colorSpace=THREE.SRGBColorSpace;
 const previous=[...new Set([leftMesh,rightMesh].filter(Boolean))];
 if(stereoMode==='mono'){
  const mesh=new THREE.Mesh(geometry(sourceAspect(source)),new THREE.MeshBasicMaterial({map:source,side:projection==='flat'?THREE.FrontSide:THREE.BackSide}));
  if(projection==='flat'){mesh.position.set(3.2,0,0);mesh.rotation.y=-Math.PI/2;}else if(projection==='180')mesh.rotation.y=Math.PI/2;
  mesh.layers.set(0);scene.add(mesh);leftMesh=rightMesh=mesh;
 }else{leftMesh=makeEye(source,'left');rightMesh=makeEye(source,'right');source.dispose()}
 for(const mesh of previous){scene.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose()}
 if(getViewerMode()===ViewerMode.DESKTOP){if(stereoMode==='mono')camera.layers.set(0);else desktopEye()}
 requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.remove('scene-loading')));
}
let tiledPanorama=null;
async function loadInitialPanorama(){
 if(projection==='360'&&stereoMode==='mono'&&root.dataset.tiles){
  try{
   tiledPanorama=await createTiledPanorama({url:root.dataset.tiles,scene,camera,renderer});
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
function goScene(i){const s=tourData.scenes[i];if(s)navigate('/viewer.php?id='+s.panorama_id+'&tour='+tour+'&scene='+s.id)}
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

let moved=false;renderer.domElement.addEventListener('pointerdown',e=>{down=true;moved=false;x0=e.clientX;y0=e.clientY;lon0=lon;lat0=lat});
addEventListener('pointerup',e=>{if(down&&!moved&&!cardboard&&!renderer.xr.isPresenting){const r=renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(p,camera);activate(raycaster.intersectObjects(hotspotObjects,false)[0]?.object)}down=false});addEventListener('pointermove',e=>{if(down&&(Math.abs(e.clientX-x0)>5||Math.abs(e.clientY-y0)>5))moved=true;if(down&&!orientation){lon=lon0+(x0-e.clientX)*.12;lat=Math.max(-85,Math.min(85,lat0+(e.clientY-y0)*.12))}});


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
 const nextTour=JSON.parse(doc.querySelector('#tour-data')?.textContent||'{}');
 tourData.current=nextTour.current??-1;
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
function syncXREyes(){if(!renderer.xr.isPresenting||stereoMode==='mono')return;const xrCam=renderer.xr.getCamera(camera);if(!xrCam?.cameras?.length)return;if(xrCam.cameras.length>=2){xrCam.cameras[0].layers.disableAll();xrCam.cameras[0].layers.enable(0);xrCam.cameras[0].layers.enable(1);xrCam.cameras[1].layers.disableAll();xrCam.cameras[1].layers.enable(0);xrCam.cameras[1].layers.enable(2)}}renderer.xr.addEventListener('sessionend',()=>{xrDebug.visible=false;hud.visible=cardboard;document.body.classList.remove('xr-presenting');document.querySelector('#controls').style.display='';document.querySelector('#top').style.display=''});
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
renderer.setAnimationLoop((time)=>{
 tiledPanorama?.update();
 const mode=getViewerMode();
 if(mode===ViewerMode.CARDBOARD&&cardboard){const canvas=renderer.domElement;canvas.style.position='fixed';canvas.style.inset='0';canvas.style.width='100vw';canvas.style.height='100dvh';canvas.style.zIndex='1'}
 if(mode===ViewerMode.CARDBOARD&&legacyCardboard){legacyVRControls.update();camera.updateMatrixWorld(true);hud.visible=false}
 syncHudPose();syncCardboardDebug();syncXRDebug();
 scene.traverse(o=>{if(o.userData?.animate)o.userData.animate(time,gazeTarget?.userData?.portal===o)});
 if(mode===ViewerMode.CARDBOARD&&orientation)deviceOrientation.update();
 if(mode===ViewerMode.DESKTOP&&!orientation){const phi=THREE.MathUtils.degToRad(90-lat),theta=THREE.MathUtils.degToRad(lon);camera.lookAt(500*Math.sin(phi)*Math.cos(theta),500*Math.cos(phi),500*Math.sin(phi)*Math.sin(theta))}
 if(mode===ViewerMode.WEBXR){syncXREyes();updateGaze();renderer.render(scene,camera);return}
 if(mode===ViewerMode.CARDBOARD){updateCardboardGaze();if(legacyCardboard)legacyVREffect.render(scene,camera);else renderCardboard();return}
 renderer.render(scene,camera);
});
setTimeout(()=>document.querySelector('#viewer-help')?.classList.add('hide'),4200);