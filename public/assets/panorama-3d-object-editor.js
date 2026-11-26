import {createBloomPipeline} from '/assets/panorama-bloom.js';
import * as THREE from '/assets/vendor/three/three.module.js';
import {parseSTL,parseGLB,styleModel} from '/assets/panorama-3d-objects.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
document.querySelectorAll('.object-stage').forEach(async stage=>{
 const canvas=stage.querySelector('canvas'),card=stage.closest('.panel'),form=card?.querySelector('form[action],form');
 const status=card?.querySelector('[data-stage-status]');
 if(!canvas||!form)return;
 const controls={};stage.parentElement.querySelectorAll('[data-live-control]').forEach(el=>controls[el.dataset.liveControl]=el);
 const fields={};form.querySelectorAll('input[name]').forEach(el=>fields[el.name]=el);
 const initial={};for(const k of ['x','y','distance','scale','rotX','rotY','rotZ'])initial[k]=Number(fields[k]?.value??({distance:24,scale:1}[k]??0));
 const scene=new THREE.Scene();scene.background=new THREE.Color(0x07131e);
 const envCanvas=document.createElement('canvas');envCanvas.width=1024;envCanvas.height=512;const envCtx=envCanvas.getContext('2d');const envGrad=envCtx.createLinearGradient(0,0,0,512);envGrad.addColorStop(0,'#c6d6e8');envGrad.addColorStop(.38,'#52677e');envGrad.addColorStop(.58,'#111c2a');envGrad.addColorStop(1,'#8297aa');envCtx.fillStyle=envGrad;envCtx.fillRect(0,0,1024,512);for(const [x,y,w,h] of [[100,75,180,28],[390,45,120,42],[690,90,210,24],[260,300,240,18],[760,340,150,24]]){envCtx.fillStyle='#ffffff';envCtx.shadowColor='#ffffff';envCtx.shadowBlur=28;envCtx.fillRect(x,y,w,h);envCtx.shadowBlur=0;}const envTexture=new THREE.CanvasTexture(envCanvas);envTexture.mapping=THREE.EquirectangularReflectionMapping;envTexture.colorSpace=THREE.SRGBColorSpace;scene.environment=envTexture;
 const camera=new THREE.PerspectiveCamera(48,1,.1,1000);camera.position.set(0,0,0);camera.lookAt(0,0,-30);
 const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});renderer.setPixelRatio(Math.min(devicePixelRatio||1,1.7));renderer.outputColorSpace=THREE.SRGBColorSpace;const bloomPipeline=createBloomPipeline(renderer);
 scene.add(new THREE.HemisphereLight(0xc9eaff,0x172033,2.1));
 const key=new THREE.DirectionalLight(0xffffff,2.2);key.position.set(-5,8,7);scene.add(key);
 const fill=new THREE.PointLight(0x42bfff,35,100);fill.position.set(5,2,-12);scene.add(fill);
 const grid=new THREE.GridHelper(80,40,0x34718d,0x1a3548);grid.rotation.x=Math.PI/2;grid.position.z=-30;scene.add(grid);
 const axes=new THREE.AxesHelper(3);axes.position.z=-30;scene.add(axes);
 const cameraMarker=new THREE.Mesh(new THREE.SphereGeometry(.22,16,12),new THREE.MeshBasicMaterial({color:0x55e6ff}));cameraMarker.position.set(0,0,-1.3);scene.add(cameraMarker);
 const direction=new THREE.ArrowHelper(new THREE.Vector3(0,0,-1),new THREE.Vector3(0,0,-1.7),2,0x55e6ff,.5,.3);scene.add(direction);
 const group=new THREE.Group();scene.add(group);let model=null,boxSize=1,last=0,drag=null,raf=0,disposed=false;
 const read=k=>Number(fields[k]?.value??initial[k]??0);
 const write=(k,v)=>{v=Number(v.toFixed(2));if(fields[k])fields[k].value=String(v);if(controls[k])controls[k].value=String(v);const out=stage.parentElement.querySelector('[data-live-value="'+k+'"]');if(out)out.textContent=v.toFixed(2);};
 const sync=()=>{for(const k of Object.keys(controls))write(k,read(k));for(const k of ['rotX','rotY','rotZ'])if(fields[k])fields[k].value=String(read(k));};
 const apply=()=>{group.position.set(read('x'),read('y'),-Math.max(1,read('distance')));const scale=clamp(read('scale'),.001,100)/boxSize;group.scale.setScalar(scale);group.rotation.set(THREE.MathUtils.degToRad(read('rotX')),THREE.MathUtils.degToRad(read('rotY')),THREE.MathUtils.degToRad(read('rotZ')));};
 function resize(){const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
 try{
  const response=await fetch(stage.dataset.modelUrl,{credentials:'same-origin'});if(!response.ok)throw new Error('HTTP '+response.status);
  const buffer=await response.arrayBuffer();model=(stage.dataset.modelFormat||'glb')==='stl'?new THREE.Mesh(parseSTL(buffer),new THREE.MeshStandardMaterial({color:0x9bc8df,metalness:.25,roughness:.5})):parseGLB(buffer);
  styleModel(model,stage.dataset.modelStyle||'original',fields.display?.value||stage.dataset.modelDisplay||'solid');const bounds=new THREE.Box3().setFromObject(model);const size=bounds.getSize(new THREE.Vector3()),center=bounds.getCenter(new THREE.Vector3());boxSize=Math.max(size.x,size.y,size.z)||1;model.position.sub(center);group.add(model);
  const wire=new THREE.Box3Helper(new THREE.Box3(new THREE.Vector3(-boxSize/2,-boxSize/2,-boxSize/2),new THREE.Vector3(boxSize/2,boxSize/2,boxSize/2)),0x4ecdf2);wire.visible=false;group.add(wire);
  apply();sync();if(status)status.textContent='Модель загружена. Голубая точка — камера; сетка — ориентир сцены.';
 }catch(e){if(status)status.textContent='Не удалось показать модель: '+e.message;console.warn('3D object editor preview',e);}
 const render=now=>{if(disposed)return;raf=requestAnimationFrame(render);const dt=last?Math.min(.05,(now-last)/1000):0;last=now;if(fields.spin?.checked)group.rotation.y+=dt*(Number(fields.spinY?.value)||.35);resize();if(fields.bloom?.checked)bloomPipeline.render(scene,camera,Number(fields.bloomStrength?.value)||1.2);else renderer.render(scene,camera);};
 raf=requestAnimationFrame(render);
 for(const [k,el] of Object.entries(controls)){el.addEventListener('input',()=>{write(k,Number(el.value));apply();});}
 fields.display?.addEventListener('change',()=>{if(model){styleModel(model,fields.style?.value||stage.dataset.modelStyle||'original',fields.display.value);}});
 fields.style?.addEventListener('change',()=>{if(model){styleModel(model,fields.style.value,fields.display?.value||'solid');}});
 fields.bloomStrength?.addEventListener('input',()=>{});

 for(const k of ['x','y','distance','scale','rotX','rotY','rotZ'])fields[k]?.addEventListener('input',()=>{sync();apply();});
 const point=e=>{const rect=canvas.getBoundingClientRect();return {x:e.clientX-rect.left,y:e.clientY-rect.top,rect};};
 canvas.addEventListener('pointerdown',e=>{if(!model)return;const p=point(e);drag={x:p.x,y:p.y,ox:read('x'),oy:read('y')};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';});
 canvas.addEventListener('pointermove',e=>{if(!drag)return;const p=point(e),worldPerPixel=2*Math.max(1,read('distance'))*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/p.rect.height;write('x',drag.ox+(p.x-drag.x)*worldPerPixel);write('y',drag.oy-(p.y-drag.y)*worldPerPixel);apply();});
 const stop=()=>{drag=null;canvas.style.cursor='grab';};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);
 canvas.addEventListener('wheel',e=>{e.preventDefault();write('distance',clamp(read('distance')+Math.sign(e.deltaY)*Math.max(1,read('distance')*.06),2,250));apply();},{passive:false});
 stage.parentElement.querySelector('[data-center-model]')?.addEventListener('click',()=>{write('x',0);write('y',0);apply();});
 stage.parentElement.querySelector('[data-reset-view]')?.addEventListener('click',()=>{for(const [k,v] of Object.entries(initial))write(k,v);apply();});
 const observer=new ResizeObserver(resize);observer.observe(stage);
 window.addEventListener('pagehide',()=>{disposed=true;cancelAnimationFrame(raf);observer.disconnect();bloomPipeline.dispose();envTexture.dispose();scene.traverse(o=>{o.geometry?.dispose?.();if(o.material){for(const m of (Array.isArray(o.material)?o.material:[o.material]))m.dispose?.();}});renderer.dispose();},{once:true});
 canvas.style.cursor='grab';
});
