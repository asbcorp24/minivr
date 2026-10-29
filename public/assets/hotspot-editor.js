import * as THREE from '/assets/vendor/three/three.module.js';
const root=document.querySelector('#hotspot-editor'),scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera(75,root.clientWidth/Math.max(root.clientHeight,1),.1,1100),r=new THREE.WebGLRenderer({antialias:true});root.appendChild(r.domElement);
let lon=0,lat=0,down=false,x=0,y=0,l0=0,a0=0;const projection=root.dataset.projection||'360',stereo=root.dataset.stereo||'mono';
new THREE.TextureLoader().load(root.dataset.image,t=>{t.colorSpace=THREE.SRGBColorSpace;if(stereo==='sbs'){t.repeat.set(.5,1)}else if(stereo==='tb'){t.repeat.set(1,.5);t.offset.y=.5}let g;if(projection==='flat')g=new THREE.PlaneGeometry(4.8,2.7);else if(projection==='180')g=new THREE.SphereGeometry(500,64,40,0,Math.PI);else g=new THREE.SphereGeometry(500,64,40);const m=new THREE.Mesh(g,new THREE.MeshBasicMaterial({map:t,side:projection==='flat'?THREE.FrontSide:THREE.BackSide}));if(projection==='flat')m.position.z=-3.2;else if(projection==='180')m.rotation.y=Math.PI/2;scene.add(m)});
// Capture touch gestures on the canvas instead of letting the page scroll.
r.domElement.style.touchAction='none';
r.domElement.style.cursor='grab';
let lastX=0,lastY=0,activePointer=null;
const dragSensitivity=0.34; // degrees per CSS pixel, works for mouse and touch
r.domElement.addEventListener('pointerdown',e=>{
 if(activePointer!==null)return;
 activePointer=e.pointerId;down=true;lastX=e.clientX;lastY=e.clientY;
 r.domElement.setPointerCapture?.(e.pointerId);
 r.domElement.style.cursor='grabbing';
 e.preventDefault();
});
r.domElement.addEventListener('pointermove',e=>{
 if(!down||e.pointerId!==activePointer)return;
 const dx=e.clientX-lastX,dy=e.clientY-lastY;
 lon-=dx*dragSensitivity;
 lat=Math.max(-85,Math.min(85,lat+dy*dragSensitivity));
 lastX=e.clientX;lastY=e.clientY;
 e.preventDefault();
});
function stopDrag(e){if(e.pointerId!==activePointer)return;down=false;activePointer=null;r.domElement.style.cursor='grab';try{r.domElement.releasePointerCapture(e.pointerId)}catch{}}
r.domElement.addEventListener('pointerup',stopDrag);
r.domElement.addEventListener('pointercancel',stopDrag);
r.domElement.addEventListener('lostpointercapture',stopDrag);
function size(){const w=root.clientWidth,h=root.clientHeight;r.setSize(w,h,false);cam.aspect=w/h;cam.updateProjectionMatrix()}new ResizeObserver(size).observe(root);size();
const yawInput=document.querySelector('#yaw'),pitchInput=document.querySelector('#pitch');
function syncPoint(){yawInput.value=lon.toFixed(1);pitchInput.value=lat.toFixed(1)}
r.setAnimationLoop(()=>{const p=THREE.MathUtils.degToRad(90-lat),q=THREE.MathUtils.degToRad(lon);cam.lookAt(500*Math.sin(p)*Math.cos(q),500*Math.cos(p),500*Math.sin(p)*Math.sin(q));syncPoint();r.render(scene,cam)});
document.querySelector('#capture').onclick=()=>{syncPoint();root.classList.add('flash');setTimeout(()=>root.classList.remove('flash'),220)};
document.querySelector('.hotspot-form')?.addEventListener('submit',syncPoint);
const fullscreenButton=document.querySelector('#hotspot-fullscreen');
function syncFullscreenButton(){
 const expanded=document.fullscreenElement===root||root.classList.contains('hotspot-expanded');
 fullscreenButton.querySelector('span').textContent=expanded?'Свернуть':'На весь экран';
 fullscreenButton.setAttribute('aria-label',expanded?'Свернуть панораму':'Развернуть панораму');
 fullscreenButton.firstChild.textContent=expanded?'⤢ ':'⛶ ';
 size();
}
fullscreenButton?.addEventListener('click',async()=>{
 if(document.fullscreenElement===root){await document.exitFullscreen();return}
 if(root.classList.contains('hotspot-expanded')){root.classList.remove('hotspot-expanded');syncFullscreenButton();return}
 try{if(!root.requestFullscreen)throw new Error('Fullscreen unavailable');await root.requestFullscreen()}catch{root.classList.add('hotspot-expanded');syncFullscreenButton()}
});
document.addEventListener('fullscreenchange',syncFullscreenButton);
