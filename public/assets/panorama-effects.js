import * as THREE from '/assets/vendor/three/three.module.js';
export function createPanoramaEffects(scene,settings){
 let type=['rain','snow','leaves','insects','dust','birds'].includes(settings?.particles)?settings.particles:'none';
 const density=Math.max(0,Math.min(100,Number(settings?.density)||0));
 const speed=Math.max(.1,Math.min(4,Number(settings?.speed)||1));
 const wind=THREE.MathUtils.clamp(Number(settings?.wind)||0,-8,8);
 const opacity=THREE.MathUtils.clamp(Number(settings?.opacity??80)/100,.1,1);
 const mobile=matchMedia('(max-width: 800px)').matches;
 const count=type==='none'?0:Math.round(density*(type==='rain'?8:type==='snow'?5:type==='dust'?7:type==='insects'?2.5:type==='birds'?.13:3)*(mobile?.6:1));
 if(!count)return {update(){},dispose(){}};
 const positions=new Float32Array(count*3),velocities=new Float32Array(count),drift=new Float32Array(count),colors=new Float32Array(count*3),sizes=new Float32Array(count);
 const layerDepths=[5,11,20],layerSpeed=[1.22,1,.72];
 const randomize=i=>{
  const layer=i%3,depth=layerDepths[layer],angle=Math.random()*Math.PI*2,radius=depth*(.55+Math.random()*.45);
  positions[i*3]=Math.cos(angle)*radius;
  positions[i*3+1]=(Math.random()-.5)*22;
  positions[i*3+2]=Math.sin(angle)*radius;
  velocities[i]=(.35+Math.random()*.85)*layerSpeed[layer];
  drift[i]=Math.random()*6.28;
  sizes[i]=(.65+Math.random()*.65)*(layer===0?1.12:layer===2?.78:1);
  const palette=type==='birds'?['#202c35','#39444a','#555e65']:type==='insects'?['#303b29','#4d5135','#827c58']:type==='dust'?['#e6d9b7','#f0e6d1','#b9c3c1']:type==='leaves'?['#bd6a22','#e7b454','#a94a21','#a4a04d']:type==='snow'?['#ffffff','#e7f5ff']:['#a5c8e5','#d4e9f9'];
  const color=new THREE.Color(palette[Math.floor(Math.random()*palette.length)]);
  colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
 };
 for(let i=0;i<count;i++)randomize(i);
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
 const mat=new THREE.ShaderMaterial({
 uniforms:{uTime:{value:0},uRatio:{value:Math.min(devicePixelRatio||1,2)},uOpacity:{value:opacity},uWind:{value:wind}},
 vertexShader:'attribute vec3 color;attribute float aSize;uniform float uRatio;varying vec3 vColor;varying float vFade;void main(){vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.0);float d=max(1.0,-mv.z);vFade=smoothstep(1.0,3.0,d)*(1.0-smoothstep(22.0,31.0,d));gl_Position=projectionMatrix*mv;gl_PointSize=clamp('+ (type==='rain'?'13.0':type==='snow'?'24.0':type==='dust'?'9.0':type==='insects'?'13.0':type==='birds'?'80.0':'31.0') +'*aSize*uRatio*8.0/d,2.0,35.0);}',
 fragmentShader:'precision mediump float;varying vec3 vColor;varying float vFade;uniform float uTime;uniform float uOpacity;void main(){vec2 p=gl_PointCoord*2.0-1.0;float a=0.0;'+(type==='rain'?'a=(1.0-smoothstep(.07,.20,abs(p.x+p.y*.17)))*(1.0-smoothstep(.7,1.0,abs(p.y)))*.6;':type==='snow'?'a=(1.0-smoothstep(.25,.95,length(p)))*.85;':type==='dust'?'a=(1.0-smoothstep(.1,.92,length(p)))*.38;':type==='insects'?'float wing=abs(p.y-.15*sin(uTime*23.0+p.x*4.0));a=(1.0-smoothstep(.18,.37,length(p)))*.88+(.22-smoothstep(.04,.24,wing))*step(.15,abs(p.x))*.4;':type==='birds'?'float wing=abs(p.y-(.17+.30*abs(p.x))*sin(uTime*5.0));a=(1.0-smoothstep(.035,.14,wing))*smoothstep(.85,.62,abs(p.x));a+=.6*(1.0-smoothstep(.06,.2,length(p*vec2(2.5,1.0))));':'float t=uTime*.6;mat2 r=mat2(cos(t),-sin(t),sin(t),cos(t));vec2 q=r*p;a=(1.0-smoothstep(.55,.85,length(vec2(q.x*1.2,q.y*.8))))*.9;')+'if(a<.015)discard;gl_FragColor=vec4(vColor,a*vFade*uOpacity);}',
 transparent:true,depthWrite:false,depthTest:true
 });
 const particles=new THREE.Points(geo,mat);particles.frustumCulled=false;particles.layers.enableAll();particles.renderOrder=12;scene.add(particles);
 let prev=0;
 function update(time,camera){
  if(!prev){prev=time;return}const dt=Math.min(.05,(time-prev)/1000);prev=time;
  mat.uniforms.uTime.value=time*.001;if(camera){camera.getWorldPosition(particles.position)}
  for(let i=0;i<count;i++){
   const n=i*3;positions[n+1]+=dt*speed*velocities[i]*(type==='birds'?.3:type==='insects'?.3:type==='dust'?.12:-(type==='rain'?17:type==='snow'?2:3));
   positions[n]+=(Math.sin(time*(type==='insects'?.003:type==='birds'?.0004:.0006)+drift[i])*(type==='insects'?2.5:type==='birds'?1.5:type==='dust'?.4:type==='rain'?.5:type==='snow'?1.1:2.8)+wind+(type==='birds'?3:0))*dt*speed;positions[n+2]+=Math.cos(time*(type==='insects'?.002:.0004)+drift[i])*dt*(type==='birds'?2:type==='insects'?1.7:type==='leaves'?1.2:.25);
   if(positions[n+1]<-11||positions[n+1]>11||Math.abs(positions[n])>24||Math.abs(positions[n+2])>24){const layer=i%3,depth=layerDepths[layer],angle=Math.random()*Math.PI*2,radius=depth*(.55+Math.random()*.45);positions[n+1]=type==='birds'||type==='insects'||type==='dust'?(Math.random()-.5)*18:11;positions[n]=Math.cos(angle)*radius;positions[n+2]=Math.sin(angle)*radius}
  }geo.attributes.position.needsUpdate=true;
 }
 function dispose(){scene.remove(particles);geo.dispose();mat.dispose()}
 return {update,dispose};
}
