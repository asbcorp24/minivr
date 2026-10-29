import * as THREE from '/assets/vendor/three/three.module.js';
/** Additive atmospheric layers. All resources are owned and disposed by this module. */
export function createAtmosphere(scene,settings={}){
 const parts=[],updates=[];const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||0));
 const makeCloud=(color,alpha,count,radius,baseY,kind)=>{
  const positions=new Float32Array(count*3),phase=new Float32Array(count),size=new Float32Array(count);
  for(let i=0;i<count;i++){const a=Math.random()*Math.PI*2,r=radius*(.35+.65*Math.random());positions[3*i]=Math.cos(a)*r;positions[3*i+1]=baseY+(Math.random()-.5)*8;positions[3*i+2]=Math.sin(a)*r;phase[i]=Math.random()*6.283;size[i]=.6+Math.random()*.9}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('aPhase',new THREE.BufferAttribute(phase,1));geo.setAttribute('aSize',new THREE.BufferAttribute(size,1));
  const mat=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uAlpha:{value:alpha},uColor:{value:new THREE.Color(color)},uPixel:{value:Math.min(devicePixelRatio||1,2)}},
   vertexShader:'attribute float aPhase;attribute float aSize;uniform float uTime;uniform float uPixel;varying float vFade;void main(){vec3 p=position;p.x+=sin(uTime*.16+aPhase)*1.8;p.y+=sin(uTime*.27+aPhase)*.55;vec4 mv=modelViewMatrix*vec4(p,1.);float d=max(1.,-mv.z);vFade=smoothstep(1.,4.,d)*(1.-smoothstep(25.,40.,d));gl_Position=projectionMatrix*mv;gl_PointSize=clamp('+ (kind==='fog'?'160.':'19.') +'*aSize*uPixel*10./d,2.,'+(kind==='fog'?'190.':'25.')+');}',
   fragmentShader:'precision mediump float;uniform vec3 uColor;uniform float uAlpha;uniform float uTime;varying float vFade;void main(){vec2 uv=gl_PointCoord*2.-1.;float d=length(uv);float a=pow(max(0.,1.-smoothstep(.0,1.,d)),'+(kind==='fog'?'2.':'1.5')+');'+(kind==='fireflies'?'a*=.65+.35*sin(uTime*3.+gl_FragCoord.x*.05);':'')+'gl_FragColor=vec4(uColor,a*uAlpha*vFade);}',
   transparent:true,depthWrite:false,depthTest:true,blending:kind==='fireflies'?THREE.AdditiveBlending:THREE.NormalBlending});
  const points=new THREE.Points(geo,mat);points.frustumCulled=false;points.layers.enableAll();scene.add(points);parts.push({object:points,geo,mat});
  updates.push((t,camera)=>{mat.uniforms.uTime.value=t*.001;camera.getWorldPosition(points.position)});
 };
 if(settings.fog)makeCloud('#d5e4e9',clamp(settings.fogDensity,0,100)/100*.22,Math.round(clamp(settings.fogDensity,0,100)*1.6),23,clamp(settings.fogHeight,-10,10),'fog');
 if(settings.fireflies)makeCloud('#ffdc70',.85,Math.round(clamp(settings.fireflyDensity,0,100)*1.2),12,0,'fireflies');
 let lightning=null;
 if(settings.storm){
  const intensity=clamp(settings.stormIntensity,0,100)/100;
  const flash=new THREE.Mesh(new THREE.SphereGeometry(490,24,12),new THREE.MeshBasicMaterial({color:0xc2ddff,transparent:true,opacity:0,side:THREE.BackSide,depthWrite:false,depthTest:false}));
  flash.layers.enableAll();flash.renderOrder=20;scene.add(flash);parts.push({object:flash,geo:flash.geometry,mat:flash.material});
  let next=3+Math.random()*7,start=-100;
  updates.push((time,camera)=>{const t=time*.001;if(t>next){start=t;next=t+4+Math.random()*11/(intensity+.15)}const dt=t-start;flash.material.opacity=dt>=0&&dt<.36?intensity*(dt<.07?.24:dt<.14?.04:dt<.23?.14:.0):0;camera.getWorldPosition(flash.position)});
 }
 if(settings.sunRays){
  const intensity=clamp(settings.sunIntensity,0,100)/100;
  const sun=new THREE.Sprite(new THREE.SpriteMaterial({color:0xffdfa0,transparent:true,opacity:intensity*.13,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending}));
  const yaw=THREE.MathUtils.degToRad(clamp(settings.sunYaw,-180,180)),pitch=THREE.MathUtils.degToRad(clamp(settings.sunPitch,-90,90));sun.position.set(-280*Math.cos(pitch)*Math.cos(yaw),280*Math.sin(pitch),280*Math.cos(pitch)*Math.sin(yaw));sun.scale.set(210,210,1);sun.layers.enableAll();scene.add(sun);parts.push({object:sun,geo:null,mat:sun.material});
  updates.push((t)=>{sun.material.opacity=intensity*(.12+.025*Math.sin(t*.0004))});
 }
 if(settings.water){
  const yaw=THREE.MathUtils.degToRad(clamp(settings.waterYaw,-180,180)),pitch=THREE.MathUtils.degToRad(clamp(settings.waterPitch,-90,90)),radius=THREE.MathUtils.degToRad(clamp(settings.waterRadius,2,70));
  const center=new THREE.Vector3(-Math.cos(pitch)*Math.cos(yaw),Math.sin(pitch),Math.cos(pitch)*Math.sin(yaw));
  const axis=new THREE.Vector3(0,1,0);if(Math.abs(center.dot(axis))>.95)axis.set(1,0,0);
  const right=new THREE.Vector3().crossVectors(center,axis).normalize(),up=new THREE.Vector3().crossVectors(center,right).normalize();
  const ringCount=12,segments=48,verts=new Float32Array(ringCount*segments*3);
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(verts,3));
  const mat=new THREE.PointsMaterial({color:0xc5e9ff,size:.52,transparent:true,opacity:.42,depthWrite:false,blending:THREE.AdditiveBlending,sizeAttenuation:true});
  const ripples=new THREE.Points(geo,mat);ripples.frustumCulled=false;ripples.layers.enableAll();scene.add(ripples);parts.push({object:ripples,geo,mat});
  updates.push((time,camera)=>{
   const t=time*.0003;camera.getWorldPosition(ripples.position);
   for(let k=0;k<ringCount;k++){
    const phase=(t*(.6+(k%3)*.13)+k*.137)%1;
    const rr=radius*(.12+phase*.88),r=18;
    for(let j=0;j<segments;j++){
     const a=j/segments*Math.PI*2,point=center.clone().multiplyScalar(Math.cos(rr)).addScaledVector(right,Math.sin(rr)*Math.cos(a)).addScaledVector(up,Math.sin(rr)*Math.sin(a)).normalize().multiplyScalar(r);
     const idx=(k*segments+j)*3;verts[idx]=point.x;verts[idx+1]=point.y;verts[idx+2]=point.z;
    }
   }
   geo.attributes.position.needsUpdate=true;
   mat.opacity=.18+.18*Math.sin(time*.001);
  });
 }
 return {update(time,camera){for(const fn of updates)fn(time,camera)},dispose(){for(const p of parts){scene.remove(p.object);p.geo?.dispose();p.mat.dispose()}}};
}
