import * as THREE from '/assets/vendor/three/three.module.js';
// Moon glow and moving moonlight on the user-selected water region.
export function createMoonlight(scene,settings={}){
 if(!settings.moon)return {update(){},dispose(){}};
 const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||0));
 const yaw=THREE.MathUtils.degToRad(clamp(settings.moonYaw,-180,180));
 const pitch=THREE.MathUtils.degToRad(clamp(settings.moonPitch,-90,90));
 const strength=clamp(settings.moonIntensity??55,0,100)/100;
 const width=clamp(settings.moonPathWidth??16,2,60);
 const dir=new THREE.Vector3(-Math.cos(pitch)*Math.cos(yaw),Math.sin(pitch),Math.cos(pitch)*Math.sin(yaw));
 const resources=[],updates=[];
 const moon=new THREE.Sprite(new THREE.SpriteMaterial({color:0xdce9ff,transparent:true,opacity:.7*strength,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));
 moon.position.copy(dir).multiplyScalar(350);moon.scale.set(24,24,1);moon.layers.enableAll();scene.add(moon);resources.push([moon,null,moon.material]);
 const glow=new THREE.Sprite(new THREE.SpriteMaterial({color:0x9dbce8,transparent:true,opacity:.12*strength,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));
 glow.position.copy(dir).multiplyScalar(348);glow.scale.set(90,90,1);glow.layers.enableAll();scene.add(glow);resources.push([glow,null,glow.material]);
 updates.push(t=>{glow.material.opacity=strength*(.10+.025*Math.sin(t*.00035))});
 if(settings.moonPath!==false && settings.water){
  const polygon=Array.isArray(settings.waterPolygon)?settings.waterPolygon.filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)).slice(0,80):[];
  const centerYaw=clamp(settings.waterYaw,-180,180);
  const unwrap=x=>((x-centerYaw+540)%360)-180;
  const poly=polygon.map(p=>[unwrap(p[0]),p[1]]);
  const inside=(x,y)=>{if(poly.length<3)return true;let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const a=poly[i],b=poly[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit}return hit};
  const count=320,positions=new Float32Array(count*3),phase=new Float32Array(count),sizes=new Float32Array(count);
  const geo=new THREE.BufferGeometry();
  for(let i=0;i<count;i++){phase[i]=Math.random()*Math.PI*2;sizes[i]=.3+Math.random()*.7}
  geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('aPhase',new THREE.BufferAttribute(phase,1));geo.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
  const mat=new THREE.ShaderMaterial({
   uniforms:{uTime:{value:0},uOpacity:{value:strength*.75},uPixel:{value:Math.min(devicePixelRatio||1,2)}},
   vertexShader:'attribute float aPhase;attribute float aSize;uniform float uTime;uniform float uPixel;varying float vAlpha;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp((5.+aSize*8.)*uPixel,2.,16.);vAlpha=(.5+.5*sin(uTime*2.5+aPhase))*aSize;}',
   fragmentShader:'precision mediump float;uniform float uOpacity;varying float vAlpha;void main(){float d=length(gl_PointCoord-.5)*2.;float a=(1.-smoothstep(.1,1.,d))*vAlpha*uOpacity;if(a<.01)discard;gl_FragColor=vec4(.72,.83,1.,a);}',
   transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending
  });
  const points=new THREE.Points(geo,mat);points.layers.enableAll();points.frustumCulled=false;scene.add(points);resources.push([points,geo,mat]);
  const horizon=clamp(settings.moonHorizon??-2,-30,10),bottom=clamp(settings.moonBottom??-70,-90,-10);
  updates.push((time,camera)=>{
   mat.uniforms.uTime.value=time*.001;camera.getWorldPosition(points.position);
   for(let i=0;i<count;i++){
    const depth=(i+.5)/count,el=horizon+(bottom-horizon)*depth;
    const spread=width*(.2+depth*.8);
    const wav=Math.sin(time*.0015+phase[i]*3+depth*19)*1.8;
    const az=THREE.MathUtils.radToDeg(yaw)+(Math.sin(phase[i]*5.17+i*3.17)*spread)+wav;
    const normalized=((az+180)%360+360)%360-180;
    const visible=inside(unwrap(normalized),el);
    const a=THREE.MathUtils.degToRad(normalized),b=THREE.MathUtils.degToRad(el),r=35;
    const idx=i*3;positions[idx]=visible?-r*Math.cos(b)*Math.cos(a):10000;positions[idx+1]=visible?r*Math.sin(b):10000;positions[idx+2]=visible?r*Math.cos(b)*Math.sin(a):10000;
   }
   geo.attributes.position.needsUpdate=true;
  });
 }
 return {update(t,c){for(const fn of updates)fn(t,c)},dispose(){for(const [obj,geo,mat] of resources){scene.remove(obj);geo?.dispose();mat.dispose()}}};
}
