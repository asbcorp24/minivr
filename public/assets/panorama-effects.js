import * as THREE from '/assets/vendor/three/three.module.js';
export function createPanoramaEffects(scene,settings){
 let type=['rain','snow','leaves'].includes(settings?.particles)?settings.particles:'none';
 const density=Math.max(0,Math.min(100,Number(settings?.density)||0));
 const speed=Math.max(.1,Math.min(4,Number(settings?.speed)||1));
 const count=type==='none'?0:Math.round(density*2.4);
 if(!count)return {update(){},dispose(){}};
 const positions=new Float32Array(count*3),velocities=new Float32Array(count),drift=new Float32Array(count);
 const randomize=i=>{positions[i*3]=(Math.random()-.5)*35;positions[i*3+1]=Math.random()*22-10;positions[i*3+2]=(Math.random()-.5)*35;velocities[i]=.3+Math.random()*.8;drift[i]=Math.random()*6.28};
 for(let i=0;i<count;i++)randomize(i);
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));
 const mat=new THREE.PointsMaterial({color:type==='rain'?0xaad9ff:type==='snow'?0xffffff:0xdba04a,size:type==='rain'?.10:type==='snow'?.23:.30,transparent:true,opacity:type==='rain'?.55:.85,depthWrite:false,sizeAttenuation:true});
 const particles=new THREE.Points(geo,mat);particles.frustumCulled=false;particles.layers.enableAll();scene.add(particles);
 let prev=0;
 function update(time,camera){
  if(!prev){prev=time;return}const dt=Math.min(.05,(time-prev)/1000);prev=time;
  if(camera)particles.position.copy(camera.position);
  for(let i=0;i<count;i++){
   const n=i*3;positions[n+1]-=dt*speed*velocities[i]*(type==='rain'?17:type==='snow'?2:3);
   positions[n]+=Math.sin(time*.0006+drift[i])*dt*(type==='rain'?.6:1.8);
   if(positions[n+1]<-11){positions[n+1]=11;positions[n]=(Math.random()-.5)*35;positions[n+2]=(Math.random()-.5)*35}
  }geo.attributes.position.needsUpdate=true;
 }
 function dispose(){scene.remove(particles);geo.dispose();mat.dispose()}
 return {update,dispose};
}
