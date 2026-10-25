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
function geometry(){
 if(projection==='flat') return new THREE.PlaneGeometry(4.8,2.7);
 if(projection==='180') return new THREE.SphereGeometry(500,64,40,0,Math.PI);
 return new THREE.SphereGeometry(500,64,40);
}
function makeEye(source,eye){
 const g=geometry(),m=new THREE.MeshBasicMaterial({map:eyeTexture(source,eye),side:projection==='flat'?THREE.FrontSide:THREE.BackSide});
 const mesh=new THREE.Mesh(g,m);
 if(projection==='flat')mesh.position.set(0,0,-3.2);
 else if(projection==='180')mesh.rotation.y=Math.PI/2;
 mesh.layers.set(eye==='left'?1:2);scene.add(mesh);return mesh;
}
new THREE.TextureLoader().load(root.dataset.image,source=>{
 source.colorSpace=THREE.SRGBColorSpace;
 if(stereoMode==='mono'){
   const mesh=new THREE.Mesh(geometry(),new THREE.MeshBasicMaterial({map:source,side:projection==='flat'?THREE.FrontSide:THREE.BackSide}));
   if(projection==='flat')mesh.position.set(0,0,-3.2);else if(projection==='180')mesh.rotation.y=Math.PI/2;
   mesh.layers.enableAll();scene.add(mesh);leftMesh=rightMesh=mesh;
 }else{leftMesh=makeEye(source,'left');rightMesh=makeEye(source,'right')}
});

camera.layers.enable(1);camera.layers.enable(2);
const hud=new THREE.Group(),interactive=[];camera.add(hud);scene.add(camera);
const panel=new THREE.Mesh(new THREE.PlaneGeometry(2.8,.48),new THREE.MeshBasicMaterial({color:0x061823,transparent:true,opacity:.82,depthTest:false}));panel.position.set(0,-1.15,-3);panel.renderOrder=100;hud.add(panel);
function label(text,x){const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#d9fbff';c.font='bold 38px monospace';c.textAlign='center';c.fillText(text,256,72);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));s.scale.set(1.25,.31,1);s.position.set(x,-1.15,-2.96);s.renderOrder=101;hud.add(s)}
function actionSprite(text,x,action){const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#0a2732ee';c.fillRect(4,4,504,120);c.strokeStyle='#51e9fa';c.lineWidth=4;c.strokeRect(4,4,504,120);c.fillStyle='#eaffff';c.font='bold 34px monospace';c.textAlign='center';c.fillText(text,256,76);const s=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));s.scale.set(1.15,.3,1);s.position.set(x,-1.15,-2.94);s.userData.action=action;s.renderOrder=105;hud.add(s);interactive.push(s);return s}
function goScene(i){const s=tourData.scenes[i];if(s)location.href='/viewer.php?id='+s.panorama_id+'&tour='+tour+'&scene='+s.id}
let menuOpen=false;const menuGroup=new THREE.Group();hud.add(menuGroup);menuGroup.visible=false;
actionSprite('←',-1.15,()=>goScene(tourData.current-1));actionSprite('MENU',-.38,()=>{menuOpen=!menuOpen;menuGroup.visible=menuOpen});actionSprite('INFO',.38,()=>{menuOpen=!menuOpen;menuGroup.visible=menuOpen});actionSprite('→',1.15,()=>goScene(tourData.current+1));
tourData.scenes.slice(0,8).forEach((s,i)=>{const cv=document.createElement('canvas');cv.width=700;cv.height=110;const c=cv.getContext('2d');c.fillStyle=i===tourData.current?'#0c6170ee':'#071923ee';c.fillRect(0,0,700,110);c.strokeStyle='#3fc9dc';c.strokeRect(2,2,696,106);c.fillStyle='#efffff';c.font='28px sans-serif';c.fillText((i+1)+'. '+s.title,28,68);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(3.3,.52,1);sp.position.set(0,1.55-i*.48,-3.1);sp.userData.action=()=>goScene(i);sp.renderOrder=110;menuGroup.add(sp);interactive.push(sp)});hud.visible=false;
const hotspotObjects=[];
function hotspotSprite(h){const cv=document.createElement('canvas');cv.width=512;cv.height=160;const c=cv.getContext('2d');c.fillStyle='#06232ddd';c.beginPath();c.roundRect(10,10,492,140,35);c.fill();c.strokeStyle='#55efff';c.lineWidth=5;c.stroke();c.fillStyle='#eaffff';c.font='bold 30px sans-serif';c.textAlign='center';c.fillText('◉  '+h.label,256,92);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true}));sp.scale.set(34,10.6,1);const yaw=THREE.MathUtils.degToRad(Number(h.yaw)),pitch=THREE.MathUtils.degToRad(Number(h.pitch)),rad=110;sp.position.set(rad*Math.cos(pitch)*Math.cos(yaw),rad*Math.sin(pitch),rad*Math.cos(pitch)*Math.sin(yaw));sp.userData=h;sp.layers.enableAll();scene.add(sp);hotspotObjects.push(sp)}
hotspotData.forEach(hotspotSprite);
const raycaster=new THREE.Raycaster();let gazeTarget=null,gazeStart=0;const pickables=()=>[...hotspotObjects,...interactive.filter(o=>o.visible&&o.parent?.visible!==false)];
function activate(o){if(o?.userData?.action)return o.userData.action();const h=o?.userData;if(h?.target_panorama_id)location.href='/viewer.php?id='+h.target_panorama_id+'&tour='+tour+'&scene='+h.target_scene_id}
for(let i=0;i<2;i++){const ctl=renderer.xr.getController(i);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0x66eeff}));line.scale.z=4;ctl.add(line);ctl.addEventListener('select',()=>{raycaster.setFromXRController(ctl);activate(raycaster.intersectObjects(pickables(),false)[0]?.object)});scene.add(ctl)}

renderer.domElement.addEventListener('pointerdown',e=>{down=true;x0=e.clientX;y0=e.clientY;lon0=lon;lat0=lat});
addEventListener('pointerup',()=>down=false);addEventListener('pointermove',e=>{if(down&&!orientation){lon=lon0+(x0-e.clientX)*.12;lat=Math.max(-85,Math.min(85,lat0+(e.clientY-y0)*.12))}});
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
 renderer.setScissorTest(false);camera.layers.enable(1);camera.layers.enable(2);camera.aspect=oldAspect;camera.updateProjectionMatrix();renderer.setViewport(0,0,w,h);
}
document.querySelector('#cardboard').onclick=()=>{cardboard=!cardboard;document.body.classList.toggle('cardboard',cardboard);hud.visible=cardboard||renderer.xr.isPresenting;if(cardboard)document.documentElement.requestFullscreen?.()};

function updateGaze(){if(!cardboard&&!renderer.xr.isPresenting)return;raycaster.setFromCamera(new THREE.Vector2(0,0),camera);const hit=raycaster.intersectObjects(pickables(),false)[0]?.object||null;if(hit!==gazeTarget){gazeTarget=hit;gazeStart=performance.now();document.body.classList.remove('gazing')}if(hit){document.body.classList.add('gazing');const elapsed=performance.now()-gazeStart;document.documentElement.style.setProperty('--gaze',Math.min(1,elapsed/1200));if(elapsed>1200){gazeStart=performance.now()+999999;activate(hit)}}else{document.body.classList.remove('gazing');document.documentElement.style.setProperty('--gaze',0)}}
renderer.xr.addEventListener('sessionstart',()=>{hud.visible=true});renderer.xr.addEventListener('sessionend',()=>{hud.visible=cardboard});
renderer.setAnimationLoop(()=>{
 if(!orientation&&!renderer.xr.isPresenting){const phi=THREE.MathUtils.degToRad(90-lat),theta=THREE.MathUtils.degToRad(lon);camera.lookAt(500*Math.sin(phi)*Math.cos(theta),500*Math.cos(phi),500*Math.sin(phi)*Math.sin(theta))}
 updateGaze();if(cardboard&&!renderer.xr.isPresenting)renderCardboard();else renderer.render(scene,camera);
});