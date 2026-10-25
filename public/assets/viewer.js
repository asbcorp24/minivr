import * as THREE from '/assets/vendor/three/three.module.js';
import {VRButton} from '/assets/vendor/three/addons/webxr/VRButton.js';

const root=document.querySelector('#viewer');
const projection=root.dataset.projection||'360', stereoMode=root.dataset.stereo||'mono';
const tour=Number(root.dataset.tour||0),hotspotData=JSON.parse(document.querySelector('#hotspots-data')?.textContent||'[]');
const tourData=JSON.parse(document.querySelector('#tour-data')?.textContent||'{"scenes":[],"current":-1}');
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,1100);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.xr.enabled=true;root.appendChild(renderer.domElement);
let cardboard=false,lon=0,lat=0,down=false,x0=0,y0=0,lon0=0,lat0=0,orientation=false,leftMesh,rightMesh;

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
 if(projection==='flat')mesh.position.set(0,0,-3.2);
 else if(projection==='180')mesh.rotation.y=Math.PI/2;
 mesh.layers.set(eye==='left'?1:2);scene.add(mesh);return mesh;
}
new THREE.TextureLoader().load(root.dataset.image,source=>{
 source.colorSpace=THREE.SRGBColorSpace;
 if(stereoMode==='mono'){
   const mesh=new THREE.Mesh(geometry(sourceAspect(source)),new THREE.MeshBasicMaterial({map:source,side:projection==='flat'?THREE.FrontSide:THREE.BackSide}));
   if(projection==='flat')mesh.position.set(0,0,-3.2);else if(projection==='180')mesh.rotation.y=Math.PI/2;
   mesh.layers.enableAll();scene.add(mesh);leftMesh=rightMesh=mesh;
 }else{leftMesh=makeEye(source,'left');rightMesh=makeEye(source,'right')}
});

function desktopEye(){camera.layers.enable(1);camera.layers.disable(2)}
if(stereoMode==='mono'){camera.layers.enable(1);camera.layers.enable(2)}else desktopEye();
const hud=new THREE.Group(),interactive=[];camera.add(hud);scene.add(camera);
const panel=new THREE.Mesh(new THREE.PlaneGeometry(4.25,.48),new THREE.MeshBasicMaterial({color:0x061823,transparent:true,opacity:.82,depthTest:false}));panel.position.set(0,-1.15,-3);panel.renderOrder=100;hud.add(panel);
function actionSprite(text,x,action,parent=hud,y=-1.15,z=-2.94,w=1.15){const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#0a2732ee';c.fillRect(4,4,504,120);c.strokeStyle='#51e9fa';c.lineWidth=4;c.strokeRect(4,4,504,120);c.fillStyle='#eaffff';c.font='bold 34px monospace';c.textAlign='center';c.fillText(text,256,76);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));s.scale.set(w,.3,1);s.position.set(x,y,z);s.userData.action=action;s.renderOrder=125;parent.add(s);interactive.push(s);return s}
function goScene(i){const s=tourData.scenes[i];if(s)navigate('/viewer.php?id='+s.panorama_id+'&tour='+tour+'&scene='+s.id)}
const menuGroup=new THREE.Group(),infoGroup=new THREE.Group(),contentGroup=new THREE.Group();hud.add(menuGroup,infoGroup,contentGroup);menuGroup.visible=infoGroup.visible=contentGroup.visible=false;
function closePanels(except=null){if(except!==menuGroup)menuGroup.visible=false;if(except!==infoGroup)infoGroup.visible=false;if(except!==contentGroup)contentGroup.visible=false;menuOpen=menuGroup.visible}
let menuOpen=false,menuPage=Math.max(0,Math.floor(Math.max(0,tourData.current)/6));
actionSprite('←',-1.55,()=>goScene(tourData.current-1));actionSprite('MENU',-.78,()=>{const show=!menuGroup.visible;closePanels(show?menuGroup:null);menuGroup.visible=show;menuOpen=show;if(show)buildMenu()});actionSprite('HOME',0,()=>navigate('/'));actionSprite('INFO',.78,()=>{const show=!infoGroup.visible;closePanels(show?infoGroup:null);infoGroup.visible=show});actionSprite('→',1.55,()=>goScene(tourData.current+1));
{const cv=document.createElement('canvas');cv.width=900;cv.height=420;const c=cv.getContext('2d');c.fillStyle='#041923f2';c.fillRect(0,0,900,420);c.strokeStyle='#55e9f8';c.lineWidth=5;c.strokeRect(4,4,892,412);c.fillStyle='#70efff';c.font='bold 25px monospace';c.fillText('SCENE INFO',40,55);c.fillStyle='#fff';c.font='bold 42px sans-serif';c.fillText((tourData.title||'').slice(0,34),40,115);c.font='25px sans-serif';const words=(tourData.description||'Нет описания').split(' ');let line='',y=170;for(const w of words){const test=line+w+' ';if(c.measureText(test).width>800){c.fillText(line,40,y);line=w+' ';y+=38}else line=test;if(y>370)break}c.fillText(line,40,y);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(4.2,1.96,1);sp.position.set(0,.25,-3);sp.renderOrder=120;infoGroup.add(sp)}
function clearGroup(g){for(const o of [...g.children]){g.remove(o);const k=interactive.indexOf(o);if(k>=0)interactive.splice(k,1);o.material?.map?.dispose?.();o.material?.dispose?.()}}
function sceneCard(s,index,x,y){const cv=document.createElement('canvas');cv.width=640;cv.height=360;const c=cv.getContext('2d');c.fillStyle=index===tourData.current?'#0c5865':'#061923';c.fillRect(0,0,640,360);c.strokeStyle=index===tourData.current?'#91f8ff':'#2f8a99';c.lineWidth=index===tourData.current?8:4;c.strokeRect(4,4,632,352);c.fillStyle='#6cefff';c.font='bold 22px monospace';c.fillText('SCENE '+String(index+1).padStart(2,'0'),26,42);c.fillStyle='#efffff';c.font='bold 31px sans-serif';let title=(s.title||'Сцена');if(title.length>28)title=title.slice(0,27)+'…';c.fillText(title,26,295);c.fillStyle='#6e929d';c.font='20px monospace';c.fillText(index===tourData.current?'CURRENT':'OPEN →',26,330);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(1.82,1.02,1);sp.position.set(x,y,-3.2);sp.userData.action=()=>goScene(index);sp.renderOrder=120;menuGroup.add(sp);interactive.push(sp);if(s.preview||s.image){new THREE.TextureLoader().load(s.preview||s.image,t=>{t.colorSpace=THREE.SRGBColorSpace;const pic=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false}));pic.scale.set(1.65,.62,1);pic.position.set(x,y+.13,-3.18);pic.renderOrder=121;pic.userData.action=()=>goScene(index);menuGroup.add(pic);interactive.push(pic)})}}
function buildMenu(){clearGroup(menuGroup);const pages=Math.max(1,Math.ceil(tourData.scenes.length/6));menuPage=Math.max(0,Math.min(menuPage,pages-1));const start=menuPage*6;tourData.scenes.slice(start,start+6).forEach((s,k)=>sceneCard(s,start+k,(k%3-1)*1.95,1.05-Math.floor(k/3)*1.15));actionSprite('‹',-1.55,()=>{if(menuPage>0){menuPage--;buildMenu()}},menuGroup,-1.28,-3.12,.72);actionSprite((menuPage+1)+' / '+pages,0,()=>{},menuGroup,-1.28,-3.12,1.15);actionSprite('›',1.55,()=>{if(menuPage<pages-1){menuPage++;buildMenu()}},menuGroup,-1.28,-3.12,.72);actionSprite('CLOSE',0,()=>{menuGroup.visible=false;menuOpen=false},menuGroup,-1.68,-3.12,1.15)}
buildMenu();hud.visible=false;
const hotspotObjects=[];let activeHotspot=null;
function markerTexture(h,active=false){const cv=document.createElement('canvas');cv.width=256;cv.height=256;const c=cv.getContext('2d');c.clearRect(0,0,256,256);c.beginPath();c.arc(128,128,82,0,Math.PI*2);c.fillStyle=active?'#29ddec':'#052530dd';c.fill();c.lineWidth=active?12:7;c.strokeStyle='#72f5ff';c.stroke();c.fillStyle='#eaffff';c.textAlign='center';c.textBaseline='middle';c.font='bold 74px sans-serif';c.fillText(h.type==='info'?'i':h.type==='image'?'▣':'→',128,132);return new THREE.CanvasTexture(cv)}
function hotspotSprite(h){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture(h),transparent:true,depthTest:false}));sp.scale.set(11,11,1);const yaw=THREE.MathUtils.degToRad(Number(h.yaw)),pitch=THREE.MathUtils.degToRad(Number(h.pitch)),rad=110;sp.position.set(rad*Math.cos(pitch)*Math.cos(yaw),rad*Math.sin(pitch),rad*Math.cos(pitch)*Math.sin(yaw));sp.userData=h;sp.userData.baseScale=11;sp.layers.enableAll();scene.add(sp);hotspotObjects.push(sp)}
hotspotData.forEach(hotspotSprite);
function contentPanel(h){closePanels(contentGroup);clearGroup(contentGroup);contentGroup.visible=true;
 const head=document.createElement('canvas');head.width=1000;head.height=190;const c=head.getContext('2d');c.fillStyle='#031720f4';c.fillRect(0,0,1000,190);c.strokeStyle='#5cecff';c.lineWidth=6;c.strokeRect(5,5,990,185);c.fillStyle='#65efff';c.font='bold 24px monospace';c.fillText(h.type==='image'?'IMAGE':'INFORMATION',42,48);c.fillStyle='#fff';c.font='bold 43px sans-serif';c.fillText((h.label||'').slice(0,36),42,118);
 const hs=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(head),transparent:true,depthTest:false}));hs.scale.set(4.3,.82,1);hs.position.set(0,1.12,-3.08);hs.renderOrder=132;contentGroup.add(hs);
 if(h.type==='image'&&h.content){new THREE.TextureLoader().load(h.content,t=>{if(!contentGroup.visible)return;t.colorSpace=THREE.SRGBColorSpace;const im=t.image||{},aspect=im.width&&im.height?im.width/im.height:16/9,maxW=4.15,maxH=2.25;let w=maxW,hg=w/aspect;if(hg>maxH){hg=maxH;w=hg*aspect}const pic=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false}));pic.scale.set(w,hg,1);pic.position.set(0,-.18,-3.04);pic.renderOrder=131;contentGroup.add(pic)},undefined,()=>addInfoText('Не удалось загрузить изображение'))}
 else addInfoText(h.content||'Нет информации');
 actionSprite('CLOSE',0,()=>{contentGroup.visible=false},contentGroup,-1.62,-3.02,1.15);
 function addInfoText(text){const cv=document.createElement('canvas');cv.width=1000;cv.height=560;const x=cv.getContext('2d');x.fillStyle='#031720f4';x.fillRect(0,0,1000,560);x.strokeStyle='#5cecff';x.lineWidth=5;x.strokeRect(4,4,992,552);x.fillStyle='#e9ffff';x.font='28px sans-serif';const words=String(text).split(' ');let line='',y=60;for(const w of words){const test=line+w+' ';if(x.measureText(test).width>890){x.fillText(line,45,y);line=w+' ';y+=43}else line=test;if(y>500)break}x.fillText(line,45,y);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(4.3,2.4,1);sp.position.set(0,-.12,-3.04);sp.renderOrder=131;contentGroup.add(sp)}
}
const raycaster=new THREE.Raycaster();let gazeTarget=null,gazeStart=0;const pickables=()=>[...hotspotObjects,...interactive.filter(o=>o.visible&&o.parent?.visible!==false)];
function activate(o){if(o?.userData?.action)return o.userData.action();const h=o?.userData;if(!h)return;if(h.type==='scene'&&h.target_panorama_id)return navigate('/viewer.php?id='+h.target_panorama_id+'&tour='+tour+'&scene='+h.target_scene_id);if(h.type==='info'||h.type==='image'){contentPanel(h);const modal=document.querySelector('#hotspot-modal');document.querySelector('#hotspot-modal-type').textContent=h.type==='image'?'ИЗОБРАЖЕНИЕ':'ИНФОРМАЦИЯ';document.querySelector('#hotspot-modal-title').textContent=h.label||'';const box=document.querySelector('#hotspot-modal-content');box.innerHTML=h.type==='image'&&h.content?'<img alt="">':'';if(h.type==='image'&&h.content)box.querySelector('img').src=h.content;else box.textContent=h.content||'';if(!cardboard&&!renderer.xr.isPresenting)modal.classList.add('open')}}
document.querySelector('#hotspot-close').onclick=()=>document.querySelector('#hotspot-modal').classList.remove('open');
for(let i=0;i<2;i++){const ctl=renderer.xr.getController(i);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0x66eeff}));line.scale.z=4;ctl.add(line);ctl.addEventListener('select',()=>{raycaster.setFromXRController(ctl);activate(raycaster.intersectObjects(pickables(),false)[0]?.object)});scene.add(ctl)}

let moved=false;renderer.domElement.addEventListener('pointerdown',e=>{down=true;moved=false;x0=e.clientX;y0=e.clientY;lon0=lon;lat0=lat});
addEventListener('pointerup',e=>{if(down&&!moved&&!cardboard&&!renderer.xr.isPresenting){const r=renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(p,camera);activate(raycaster.intersectObjects(hotspotObjects,false)[0]?.object)}down=false});addEventListener('pointermove',e=>{if(down&&(Math.abs(e.clientX-x0)>5||Math.abs(e.clientY-y0)>5))moved=true;if(down&&!orientation){lon=lon0+(x0-e.clientX)*.12;lat=Math.max(-85,Math.min(85,lat0+(e.clientY-y0)*.12))}});
addEventListener('deviceorientation',e=>{if(!orientation||e.alpha==null)return;const a=THREE.MathUtils.degToRad(e.alpha),b=THREE.MathUtils.degToRad(e.beta),g=THREE.MathUtils.degToRad(e.gamma),q=new THREE.Quaternion(),eu=new THREE.Euler(b,a,-g,'YXZ');q.setFromEuler(eu);camera.quaternion.copy(q)},true);

function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
document.querySelector('#gyro').onclick=async()=>{if(typeof DeviceOrientationEvent?.requestPermission==='function')await DeviceOrientationEvent.requestPermission();orientation=!orientation};
document.querySelector('#full').onclick=()=>document.documentElement.requestFullscreen?.();
const vrBtn=VRButton.createButton(renderer);vrBtn.style.display='none';document.body.appendChild(vrBtn);document.querySelector('#vr').onclick=()=>vrBtn.click();

function renderCardboard(){
 const w=innerWidth,h=innerHeight,oldAspect=camera.aspect;renderer.setScissorTest(true);
 camera.aspect=(w/2)/h;camera.updateProjectionMatrix();
 renderer.setViewport(0,0,w/2,h);renderer.setScissor(0,0,w/2,h);camera.layers.disable(2);camera.layers.enable(1);renderer.render(scene,camera);
 renderer.setViewport(w/2,0,w/2,h);renderer.setScissor(w/2,0,w/2,h);camera.layers.disable(1);camera.layers.enable(2);renderer.render(scene,camera);
 renderer.setScissorTest(false);if(stereoMode==='mono'){camera.layers.enable(1);camera.layers.enable(2)}else desktopEye();camera.aspect=oldAspect;camera.updateProjectionMatrix();renderer.setViewport(0,0,w,h);
}
function navigate(url){document.body.classList.add('scene-leaving');setTimeout(()=>location.href=url,180)}
document.querySelector('#cardboard').onclick=()=>{cardboard=!cardboard;document.body.classList.toggle('cardboard',cardboard);hud.visible=cardboard||renderer.xr.isPresenting;if(cardboard)document.documentElement.requestFullscreen?.()};

function updateGaze(){if(!cardboard&&!renderer.xr.isPresenting)return;raycaster.setFromCamera(new THREE.Vector2(0,0),camera);const hit=raycaster.intersectObjects(pickables(),false)[0]?.object||null;if(hit!==gazeTarget){if(gazeTarget&&hotspotObjects.includes(gazeTarget)){gazeTarget.material.map.dispose();gazeTarget.material.map=markerTexture(gazeTarget.userData,false);gazeTarget.scale.setScalar(gazeTarget.userData.baseScale)}if(hit&&hotspotObjects.includes(hit)){hit.material.map.dispose();hit.material.map=markerTexture(hit.userData,true);hit.scale.setScalar(hit.userData.baseScale*1.25)}gazeTarget=hit;gazeStart=performance.now();document.body.classList.remove('gazing')}if(hit){document.body.classList.add('gazing');const elapsed=performance.now()-gazeStart;document.documentElement.style.setProperty('--gaze',Math.min(1,elapsed/1200));if(elapsed>1200){gazeStart=performance.now()+999999;activate(hit)}}else{document.body.classList.remove('gazing');document.documentElement.style.setProperty('--gaze',0)}}
renderer.xr.addEventListener('sessionstart',()=>{hud.visible=true;setTimeout(()=>{const xrCam=renderer.xr.getCamera(camera);if(stereoMode!=='mono'&&xrCam?.cameras?.length>=2){xrCam.cameras[0].layers.set(1);xrCam.cameras[1].layers.set(2)}},0)});renderer.xr.addEventListener('sessionend',()=>{hud.visible=cardboard});
renderer.domElement.addEventListener('pointermove',e=>{if(cardboard||renderer.xr.isPresenting||down)return;const r=renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(p,camera);const hit=raycaster.intersectObjects(hotspotObjects,false)[0]?.object||null;hotspotObjects.forEach(o=>o.scale.lerp(new THREE.Vector3(...(o===hit?[13.5,13.5,1]:[11,11,1])),.18));renderer.domElement.style.cursor=hit?'pointer':'grab'});
renderer.setAnimationLoop(()=>{
 if(!orientation&&!renderer.xr.isPresenting){const phi=THREE.MathUtils.degToRad(90-lat),theta=THREE.MathUtils.degToRad(lon);camera.lookAt(500*Math.sin(phi)*Math.cos(theta),500*Math.cos(phi),500*Math.sin(phi)*Math.sin(theta))}
 updateGaze();if(cardboard&&!renderer.xr.isPresenting)renderCardboard();else renderer.render(scene,camera);
});
setTimeout(()=>document.querySelector('#viewer-help')?.classList.add('hide'),4200);