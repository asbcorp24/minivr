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
const panel=new THREE.Mesh(new THREE.PlaneGeometry(2.8,.48),new THREE.MeshBasicMaterial({color:0x061823,transparent:true,opacity:.82,depthTest:false}));panel.position.set(0,-1.15,-3);panel.renderOrder=100;hud.add(panel);
function label(text,x){const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#d9fbff';c.font='bold 38px monospace';c.textAlign='center';c.fillText(text,256,72);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));s.scale.set(1.25,.31,1);s.position.set(x,-1.15,-2.96);s.renderOrder=101;hud.add(s)}
function actionSprite(text,x,action){const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#0a2732ee';c.fillRect(4,4,504,120);c.strokeStyle='#51e9fa';c.lineWidth=4;c.strokeRect(4,4,504,120);c.fillStyle='#eaffff';c.font='bold 34px monospace';c.textAlign='center';c.fillText(text,256,76);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));s.scale.set(1.15,.3,1);s.position.set(x,-1.15,-2.94);s.userData.action=action;s.renderOrder=105;hud.add(s);interactive.push(s);return s}
function goScene(i){const s=tourData.scenes[i];if(s)navigate('/viewer.php?id='+s.panorama_id+'&tour='+tour+'&scene='+s.id)}
let menuOpen=false;const menuGroup=new THREE.Group();hud.add(menuGroup);menuGroup.visible=false;
actionSprite('←',-1.55,()=>goScene(tourData.current-1));actionSprite('MENU',-.78,()=>{menuOpen=!menuOpen;menuGroup.visible=menuOpen});actionSprite('HOME',0,()=>navigate('/'));actionSprite('INFO',.78,()=>{infoGroup.visible=!infoGroup.visible});actionSprite('→',1.55,()=>goScene(tourData.current+1));
const infoGroup=new THREE.Group();hud.add(infoGroup);infoGroup.visible=false;{const cv=document.createElement('canvas');cv.width=900;cv.height=420;const c=cv.getContext('2d');c.fillStyle='#041923f2';c.fillRect(0,0,900,420);c.strokeStyle='#55e9f8';c.lineWidth=5;c.strokeRect(4,4,892,412);c.fillStyle='#70efff';c.font='bold 25px monospace';c.fillText('SCENE INFO',40,55);c.fillStyle='#fff';c.font='bold 42px sans-serif';c.fillText((tourData.title||'').slice(0,34),40,115);c.font='25px sans-serif';const words=(tourData.description||'Нет описания').split(' ');let line='',y=170;for(const w of words){const test=line+w+' ';if(c.measureText(test).width>800){c.fillText(line,40,y);line=w+' ';y+=38}else line=test}c.fillText(line,40,y);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(4.2,1.96,1);sp.position.set(0,.25,-3);sp.renderOrder=120;infoGroup.add(sp)}
tourData.scenes.slice(0,8).forEach((s,i)=>{const cv=document.createElement('canvas');cv.width=700;cv.height=110;const c=cv.getContext('2d');c.fillStyle=i===tourData.current?'#0c6170ee':'#071923ee';c.fillRect(0,0,700,110);c.strokeStyle='#3fc9dc';c.strokeRect(2,2,696,106);c.fillStyle='#efffff';c.font='28px sans-serif';c.fillText((i+1)+'. '+s.title,28,68);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(3.3,.52,1);sp.position.set(0,1.55-i*.48,-3.1);sp.userData.action=()=>goScene(i);sp.renderOrder=110;menuGroup.add(sp);interactive.push(sp)});hud.visible=false;
const hotspotObjects=[];let activeHotspot=null;
function markerTexture(h,active=false){const cv=document.createElement('canvas');cv.width=256;cv.height=256;const c=cv.getContext('2d');c.clearRect(0,0,256,256);c.beginPath();c.arc(128,128,82,0,Math.PI*2);c.fillStyle=active?'#29ddec':'#052530dd';c.fill();c.lineWidth=active?12:7;c.strokeStyle='#72f5ff';c.stroke();c.fillStyle='#eaffff';c.textAlign='center';c.textBaseline='middle';c.font='bold 74px sans-serif';c.fillText(h.type==='info'?'i':h.type==='image'?'▣':'→',128,132);return new THREE.CanvasTexture(cv)}
function hotspotSprite(h){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture(h),transparent:true,depthTest:false}));sp.scale.set(11,11,1);const yaw=THREE.MathUtils.degToRad(Number(h.yaw)),pitch=THREE.MathUtils.degToRad(Number(h.pitch)),rad=110;sp.position.set(rad*Math.cos(pitch)*Math.cos(yaw),rad*Math.sin(pitch),rad*Math.cos(pitch)*Math.sin(yaw));sp.userData=h;sp.userData.baseScale=11;sp.layers.enableAll();scene.add(sp);hotspotObjects.push(sp)}
hotspotData.forEach(hotspotSprite);
const contentGroup=new THREE.Group();hud.add(contentGroup);contentGroup.visible=false;
function contentPanel(h){while(contentGroup.children.length)contentGroup.remove(contentGroup.children[0]);const cv=document.createElement('canvas');cv.width=1000;cv.height=600;const c=cv.getContext('2d');c.fillStyle='#031720f4';c.fillRect(0,0,1000,600);c.strokeStyle='#5cecff';c.lineWidth=6;c.strokeRect(5,5,990,590);c.fillStyle='#65efff';c.font='bold 25px monospace';c.fillText(h.type==='image'?'IMAGE':'INFORMATION',45,58);c.fillStyle='#fff';c.font='bold 45px sans-serif';c.fillText((h.label||'').slice(0,35),45,125);if(h.type==='image'){c.fillStyle='#89a5af';c.font='25px sans-serif';c.fillText('Изображение открыто на экране устройства',45,195)}else{c.font='27px sans-serif';const words=(h.content||'').split(' ');let line='',y=190;for(const w of words){const test=line+w+' ';if(c.measureText(test).width>890){c.fillText(line,45,y);line=w+' ';y+=42}else line=test;if(y>510)break}c.fillText(line,45,y)}const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(4.3,2.58,1);sp.position.set(0,.15,-3);sp.renderOrder=130;contentGroup.add(sp);contentGroup.visible=true}
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