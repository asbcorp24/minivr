import * as THREE from '/assets/vendor/three/three.module.js';
// Moon glow and moving moonlight on the user-selected water region.
export function createMoonlight(scene,settings={}){
 if(!settings.moon)return {update(){},dispose(){}};
 const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||0));
 const yaw=THREE.MathUtils.degToRad(clamp(settings.moonYaw,-180,180));
 const pitch=THREE.MathUtils.degToRad(clamp(settings.moonPitch,-90,90));
 const strength=clamp(settings.moonIntensity??55,0,100)/100;
 const width=clamp(settings.moonPathWidth??16,2,60);
 const dir=new THREE.Vector3(Math.cos(pitch)*Math.cos(yaw),Math.sin(pitch),-Math.cos(pitch)*Math.sin(yaw));
 const resources=[],updates=[];
 // Alpha-masked procedural textures: a Sprite without a map is a square.
 const makeTexture=(halo=false)=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=256;
  const ctx=canvas.getContext('2d'),cx=128,cy=128;
  if(halo){
   const gradient=ctx.createRadialGradient(cx,cy,5,cx,cy,125);
   gradient.addColorStop(0,'rgba(207,225,255,0.42)');
   gradient.addColorStop(.25,'rgba(174,204,255,0.22)');
   gradient.addColorStop(.55,'rgba(146,183,245,0.07)');
   gradient.addColorStop(1,'rgba(146,183,245,0)');
   ctx.fillStyle=gradient;ctx.fillRect(0,0,256,256);
  }else{
   const r=111;
   const gradient=ctx.createRadialGradient(99,93,6,cx,cy,r);
   gradient.addColorStop(0,'#fffef0');gradient.addColorStop(.65,'#e6edee');
   gradient.addColorStop(.94,'#c2d0dc');gradient.addColorStop(1,'#b7c8d7');
   ctx.fillStyle=gradient;ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.fill();
   ctx.save();ctx.beginPath();ctx.arc(cx,cy,r,0,Math.PI*2);ctx.clip();
   // Subtle lunar maria, deterministic so the surface does not flicker.
   const patches=[[87,105,25,.07],[151,143,29,.09],[127,77,17,.07],[109,163,21,.06],[173,105,13,.06]];
   for(const [x,y,radius,alpha] of patches){ctx.fillStyle='rgba(67,86,105,'+alpha+')';ctx.beginPath();ctx.ellipse(x,y,radius,radius*.75,.3,0,Math.PI*2);ctx.fill()}
   ctx.restore();
  }
  const texture=new THREE.CanvasTexture(canvas);texture.needsUpdate=true;return texture;
 };
 const moonTexture=makeTexture(false),glowTexture=makeTexture(true);
 const moon=new THREE.Sprite(new THREE.SpriteMaterial({map:moonTexture,color:0xffffff,transparent:true,opacity:Math.min(1,.95*strength),depthWrite:false,depthTest:false}));
 moon.position.copy(dir).multiplyScalar(350);moon.scale.set(44,44,1);moon.layers.enableAll();moon.visible=settings.moonVisible!==false;scene.add(moon);resources.push([moon,null,moon.material]);
 const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:0xffffff,transparent:true,opacity:Math.min(1,strength),depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));
 glow.position.copy(dir).multiplyScalar(348);glow.scale.set(145,145,1);glow.layers.enableAll();glow.visible=settings.moonVisible!==false;scene.add(glow);resources.push([glow,null,glow.material]);
 updates.push(t=>{glow.material.opacity=strength*(.85+.08*Math.sin(t*.00035))});
 if(settings.moonPath!==false){
  const polygon=Array.isArray(settings.waterPolygon)?settings.waterPolygon.filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)).slice(0,80):[];
  const centerYaw=clamp(settings.moonYaw,-180,180);
  const unwrap=x=>((x-centerYaw+540)%360)-180;
  const poly=polygon.map(p=>[unwrap(p[0]),p[1]]);
  const inside=(x,y)=>{if(poly.length<3)return true;let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit}return hit};
  const count=1600,positions=new Float32Array(count*3),phase=new Float32Array(count),sizes=new Float32Array(count),angles=new Float32Array(count*2);
  const hasMask=poly.length>=3;
  const minX=hasMask?Math.min(...poly.map(p=>p[0])): -width;
  const maxX=hasMask?Math.max(...poly.map(p=>p[0])): width;
  const minY=hasMask?Math.min(...poly.map(p=>p[1])):clamp(settings.moonBottom??-70,-90,-10);
  const maxY=hasMask?Math.max(...poly.map(p=>p[1])):clamp(settings.moonHorizon??-2,-30,10);
  for(let i=0;i<count;i++){
   phase[i]=Math.random()*Math.PI*2;
   sizes[i]=.35+Math.random()*.65;
   let x=0,y=0,valid=false;
   for(let attempt=0;attempt<40;attempt++){
    x=minX+Math.random()*(maxX-minX);y=minY+Math.random()*(maxY-minY);
    if(inside(x,y)){valid=true;break}
   }
   angles[i*2]=valid?x:NaN;angles[i*2+1]=y;
  }
  const geo=new THREE.BufferGeometry();
  for(let i=0;i<count;i++){phase[i]=Math.random()*Math.PI*2;sizes[i]=.3+Math.random()*.7}
  geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('aPhase',new THREE.BufferAttribute(phase,1));geo.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
  const mat=new THREE.ShaderMaterial({
   uniforms:{uTime:{value:0},uOpacity:{value:strength*1.3},uPixel:{value:Math.min(devicePixelRatio||1,2)}},
   vertexShader:'precision mediump float;attribute float aPhase;attribute float aSize;uniform float uTime;uniform float uPixel;varying float vAlpha;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((5.+aSize*8.)*uPixel,2.,16.);vAlpha=(.35+.65*sin(uTime*2.5+aPhase)*sin(uTime*2.5+aPhase))*aSize;}',
   fragmentShader:'precision mediump float;uniform float uOpacity;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.1,1.,d))*vAlpha*uOpacity;if(a<.01)discard;gl_FragColor=vec4(.72,.83,1.,a);}',
   transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending
  });
  const points=new THREE.Points(geo,mat);points.layers.enableAll();points.frustumCulled=false;scene.add(points);resources.push([points,geo,mat]);
  const horizon=clamp(settings.moonHorizon??-2,-30,10),bottom=clamp(settings.moonBottom??-70,-90,-10);
  updates.push((time,camera)=>{
   mat.uniforms.uTime.value=time*.001;camera.getWorldPosition(points.position);
   for(let i=0;i<count;i++){
    const x=angles[i*2],el=angles[i*2+1];
    const normalized=((centerYaw+x+180)%360+360)%360-180;
    const wave=Math.sin(time*.0018+phase[i]*3)*.22;
    const b=THREE.MathUtils.degToRad(el),a=THREE.MathUtils.degToRad(normalized),r=35;
    const distance=Math.abs(x);
    const band=Math.max(3,width*(.25+Math.max(0,-el)/75));
    const falloff=Math.exp(-.5*(distance/band)**2);
    // A faint glow across the entire water polygon, with brighter moon-facing reflections.
    sizes[i]=.18+.82*falloff;
    const idx=i*3,visible=Number.isFinite(x)&&inside(x+wave,el);
    positions[idx]=visible?r*Math.cos(b)*Math.cos(a):10000;
    positions[idx+1]=visible?r*Math.sin(b):10000;
    positions[idx+2]=visible?-r*Math.cos(b)*Math.sin(a):10000;
   }
   geo.attributes.aSize.needsUpdate=true;
   geo.attributes.position.needsUpdate=true;
  });
 }
 return {update(t,c){for(const fn of updates)fn(t,c)},dispose(){for(const [obj,geo,mat] of resources){scene.remove(obj);geo?.dispose();mat.dispose()}moonTexture.dispose();glowTexture.dispose()}};
}
