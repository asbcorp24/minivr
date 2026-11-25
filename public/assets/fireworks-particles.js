import * as THREE from '/assets/vendor/three/three.module.js';
export const fireworksKinds=['chrysanthemum','peony','palm','willow','ring','crackle','comet','multi','twinkle'];
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const number=(v,d)=>Number.isFinite(Number(v))&&v!==null&&v!==undefined?Number(v):d;
export function createFireworks(scene,settings){
 const mobile=matchMedia('(max-width: 800px)').matches;
 const density=clamp(number(settings.density,35),0,100);
 if(!density)return {update(){},dispose(){}};
 const speed=clamp(number(settings.speed,1),.1,4);
 const opacity=clamp(number(settings.opacity,80)/100,.1,1);
 const size=clamp(number(settings.fireworksSize,100)/100,.3,2);
 const altitude=clamp(number(settings.fireworksAltitude,22),8,55)*Math.PI/180;
 const launchDistance=clamp(number(settings.fireworksDistance,45),5,250);
 const yaw=number(settings.fireworksYaw,0)*Math.PI/180;
 const spread=clamp(number(settings.fireworksSpread,180),10,360)*Math.PI/180;
 const trail=clamp(number(settings.fireworksTrail,65)/100,0,1);
 const maxBursts=clamp(Math.round(number(settings.fireworksConcurrent,3)),1,mobile?3:6);
 const interval=clamp(number(settings.fireworksInterval,2.5),.4,12);
 const kind=fireworksKinds.includes(settings.fireworksKind)?settings.fireworksKind:'mixed';
 const palettes={mixed:['#ff435d','#ffcb55','#55aaff','#72ff9c','#e789ff','#fff2c0'],gold:['#ffb83e','#fff0a3','#ffda70'],cool:['#63baff','#c38cff','#85ffdf'],warm:['#ff4555','#ff923e','#ffdc70']};
 const palette=palettes[settings.fireworksPalette]||palettes.mixed;
 const sparks=mobile?80:150, tails=mobile?3:5, slots=maxBursts*2, perSlot=(sparks+1)*(tails+1), count=slots*perSlot;
 const arrays={position:new Float32Array(count*3),aVelocity:new Float32Array(count*3),aColor:new Float32Array(count*3),aTiming:new Float32Array(count*4),aStyle:new Float32Array(count*4)};
 const geo=new THREE.BufferGeometry();
 for(const [key,array] of Object.entries(arrays)){const attr=new THREE.BufferAttribute(array,key==='aTiming'||key==='aStyle'?4:3);attr.setUsage(THREE.DynamicDrawUsage);geo.setAttribute(key,attr);}
 const mat=new THREE.ShaderMaterial({
 uniforms:{uTime:{value:0},uOpacity:{value:opacity},uRatio:{value:Math.min(devicePixelRatio||1,2)},uWind:{value:clamp(number(settings.wind,0),-8,8)*.15}},
 vertexShader:`attribute vec3 aVelocity;attribute vec3 aColor;attribute vec4 aTiming;attribute vec4 aStyle;
 uniform float uTime,uRatio,uWind;varying vec3 vColor;varying float vAlpha;
 void main(){float t=uTime-aTiming.x-aTiming.z;float life=aTiming.y;float particleVisible=step(0.0,t)*(1.0-step(life,t))*aTiming.w;
 float age=max(t,0.0);float drag=max(.01,aStyle.y);float travel=(1.0-exp(-drag*age))/drag;
 vec3 p=position+aVelocity*travel+vec3(uWind*age*age,-aStyle.x*age*age*.5,0.0);
 vec4 mv=modelViewMatrix*vec4(p,1.0);gl_Position=projectionMatrix*mv;
 float fade=pow(max(0.0,1.0-age/max(life,.01)),.65);
 float blink=mix(1.0,.25+.75*pow(abs(sin(age*28.0+aStyle.w)),3.0),aStyle.z);
 vAlpha=particleVisible*fade*blink;vColor=aColor;gl_PointSize=clamp(uRatio*(aTiming.z>0.0?260.0:560.0)/max(1.0,-mv.z),2.0,18.0);
 if(particleVisible<.5||mv.z>=0.0)gl_Position=vec4(2.0,2.0,2.0,1.0);}`,
 fragmentShader:`varying vec3 vColor;varying float vAlpha;uniform float uOpacity;void main(){float r=length(gl_PointCoord*2.0-1.0);float a=(1.0-smoothstep(.05,1.0,r))*.65+(1.0-smoothstep(.0,.3,r))*.65;gl_FragColor=vec4(vColor,vAlpha*a*uOpacity);}`,
 transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending});
 const points=new THREE.Points(geo,mat);points.frustumCulled=false;points.layers.enableAll();points.renderOrder=31;scene.add(points);
 const expiry=new Float64Array(slots);let last=null,clock=0,next=0,previous=-1;
 const random=(a,b)=>a+Math.random()*(b-a);
 function launch(){
  if(expiry.filter(t=>t>clock).length>=maxBursts)return;
  const slot=expiry.findIndex(t=>t<=clock);if(slot<0)return;
  let index=fireworksKinds.indexOf(kind);if(index<0){index=(previous+1+Math.floor(Math.random()*(fireworksKinds.length-1)))%fireworksKinds.length;previous=index;}
  const style=fireworksKinds[index],angle=yaw+random(-spread/2,spread/2),elev=clamp(altitude+random(-.12,.12),.15,1.4),distance=random(65,85);
  const center=[Math.sin(angle)*Math.cos(elev)*distance,Math.sin(elev)*distance,-Math.cos(angle)*Math.cos(elev)*distance];
  const color=new THREE.Color(palette[Math.floor(Math.random()*palette.length)]);
  const duration=style==='willow'?4.6:style==='palm'?3.7:2.7;
  const rise=1.15;expiry[slot]=clock+rise+duration+1.2;
  const n=Math.round(sparks*(.45+.55*density/100));
  const base=slot*perSlot;
  arrays.aTiming.fill(0,base*4,(base+perSlot)*4);
  function write(i,origin,vel,col,start,life,delay,gravity,drag,blink,phase){
   arrays.position.set(origin,i*3);arrays.aVelocity.set(vel,i*3);arrays.aColor.set([col.r,col.g,col.b],i*3);
   arrays.aTiming.set([start,life,delay,1],i*4);arrays.aStyle.set([gravity,drag,blink,phase],i*4);
  }
  for(let j=0;j<n;j++){
   const a=j*2.39996323, z=1-2*(j+.5)/n, r=Math.sqrt(Math.max(0,1-z*z));
   let v=[Math.cos(a)*r,z,Math.sin(a)*r],power=random(9,15)*size,gravity=4,drag=.65,blink=0,delay=0;
   if(style==='ring')v=[Math.cos(a)*Math.cos(angle),Math.sin(a),Math.cos(a)*Math.sin(angle)];
   if(style==='palm'){const b=Math.floor(j/Math.max(1,n/9))*Math.PI*2/9;v=[Math.cos(b)+random(-.06,.06),.65+random(-.1,.1),Math.sin(b)+random(-.06,.06)];gravity=5;}
   if(style==='willow'){gravity=3;drag=.9;power*=.85;}
   if(style==='peony')power*=1.15;
   if(style==='crackle'){blink=1;delay=random(.1,.9);}
   if(style==='comet'){v=[Math.cos(a)*.3,random(.5,1),Math.sin(a)*.3];power*=1.5;}
   if(style==='multi'){delay=(j%3)*.55;power*=.65+(j%3)*.28;}
   if(style==='twinkle')blink=1;
   const col=style==='peony'||style==='multi'?new THREE.Color(palette[j%palette.length]):color;
   const vel=v.map(x=>x*power);
   for(let k=0;k<=tails;k++){if(k>0&&k/tails>trail)continue;write(base+j*(tails+1)+k,center,vel,col,clock+rise+delay,duration, k*.055,gravity,drag,blink,random(0,6.28));}
  }
  // A separate rising rocket and its luminous trail, ending at the burst.
  const rocketBase=base+sparks*(tails+1);
  const launchOrigin=[center[0],-3,center[2]],velocity=[0,(center[1]+3)/rise,0];
  for(let k=0;k<=tails;k++)write(rocketBase+k,launchOrigin,velocity,new THREE.Color('#fff1ba'),clock,rise,k*.045,0,.01,0,0);
  for(const attr of Object.values(geo.attributes))attr.needsUpdate=true;
 }
 return {update(time,camera){if(camera){camera.updateMatrixWorld();camera.getWorldPosition(points.position);camera.getWorldQuaternion(points.quaternion);}if(last===null)last=time;clock+=clamp((time-last)/1000,0,.1)*speed;last=time;mat.uniforms.uTime.value=clock;if(clock>=next){launch();next=clock+interval*random(.65,1.35);}},dispose(){scene.remove(points);geo.dispose();mat.dispose();}};
}
