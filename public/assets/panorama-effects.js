import * as THREE from '/assets/vendor/three/three.module.js';
export function createPanoramaEffects(scene,settings){
 let type=['rain','snow','leaves','insects','dust','birds'].includes(settings?.particles)?settings.particles:'none';
 const density=Math.max(0,Math.min(100,Number(settings?.density)||0));
 const speed=Math.max(.1,Math.min(4,Number(settings?.speed)||1));
 const wind=THREE.MathUtils.clamp(Number(settings?.wind)||0,-8,8);
 const opacity=THREE.MathUtils.clamp(Number(settings?.opacity??80)/100,.1,1);
 const mobile=matchMedia('(max-width: 800px)').matches;
 const count=type==='none'||density===0?0:Math.max(type==='birds'?(mobile?8:12):type==='insects'?(mobile?25:40):1,Math.round(density*(type==='rain'?8:type==='snow'?5:type==='dust'?9:type==='insects'?3:type==='birds'?.4:3)*(mobile?.6:1)));
 if(!count)return {update(){},dispose(){}};
 // Birds and insects use textured sprites instead of GL_POINTS: mobile GPUs often clamp point size.
 if(type==='birds'||type==='insects'){
  const canvas=document.createElement('canvas');canvas.width=128;canvas.height=128;
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,128,128);
  if(type==='birds'){
   ctx.fillStyle='#192632';
   ctx.beginPath();ctx.moveTo(64,69);ctx.bezierCurveTo(46,44,22,38,5,49);ctx.bezierCurveTo(26,49,42,64,62,73);ctx.bezierCurveTo(78,62,99,46,123,49);ctx.bezierCurveTo(100,36,82,45,64,69);ctx.fill();
   ctx.beginPath();ctx.ellipse(64,71,8,14,0,0,Math.PI*2);ctx.fill();
  }else{
   ctx.fillStyle='rgba(242,233,177,.72)';
   ctx.beginPath();ctx.ellipse(44,54,22,12,-.45,0,Math.PI*2);ctx.ellipse(84,54,22,12,.45,0,Math.PI*2);ctx.fill();
   ctx.fillStyle='#3d3724';ctx.beginPath();ctx.ellipse(64,69,7,18,0,0,Math.PI*2);ctx.fill();
  }
  const texture=new THREE.CanvasTexture(canvas);
  const group=new THREE.Group();group.layers.enableAll();scene.add(group);
  const objects=[];
  const total=Math.min(type==='birds'?28:130,Math.max(type==='birds'?8:22,Math.round(density*(type==='birds'?.23:1.15)*(mobile?.7:1))));
  for(let i=0;i<total;i++){
   const material=new THREE.SpriteMaterial({map:texture,transparent:true,opacity:opacity*(type==='birds'?.95:.9),depthTest:false,depthWrite:false});
   const sprite=new THREE.Sprite(material);sprite.layers.enableAll();sprite.renderOrder=30;
   const distance=type==='birds'?12+Math.random()*15:3+Math.random()*7;
   const angle=Math.random()*Math.PI*2;
   const altitude=type==='birds'?2+Math.random()*7:-2+Math.random()*6;
   const size=(type==='birds'?2.3:.33)*(.65+Math.random()*.75);
   sprite.position.set(Math.cos(angle)*distance,altitude,Math.sin(angle)*distance);
   sprite.scale.set(size*(type==='birds'?1.7:1),size,1);
   group.add(sprite);
   objects.push({sprite,material,phase:Math.random()*6.283,velocity:.4+Math.random()*.8,distance,altitude,size});
  }
  let last=0;
  return {
   update(time,camera){
    const dt=last?Math.min(.05,(time-last)/1000):0;last=time;
    if(camera)camera.getWorldPosition(group.position);
    objects.forEach((o,i)=>{
     const p=o.sprite.position,t=time*.001,phase=o.phase;
     p.x+=dt*speed*(type==='birds'?1.5:.5)*o.velocity+dt*wind*.15;
     p.y=o.altitude+Math.sin(t*(type==='birds'?.8:2.4)+phase)*o.size*(type==='birds'?.22:.8);
     p.z+=Math.cos(t*.65+phase)*dt*(type==='birds'?.65:.38);
     if(p.x>o.distance*1.3)p.x=-o.distance*1.3;
     if(type==='birds')o.sprite.scale.y=o.size*(.75+.28*Math.sin(t*5+phase));
     else o.sprite.material.rotation=Math.sin(t*6+phase)*.22;
    });
   },
   dispose(){scene.remove(group);objects.forEach(o=>o.material.dispose());texture.dispose()}
  };
 }
 const positions=new Float32Array(count*3),velocities=new Float32Array(count),drift=new Float32Array(count),colors=new Float32Array(count*3),sizes=new Float32Array(count);
 const layerDepths=type==='birds'?[9,14,19]:type==='insects'?[3,5,8]:type==='dust'?[2.5,5,9]:[5,11,20],layerSpeed=[1.22,1,.72];
 const randomize=i=>{
  const layer=i%3,depth=layerDepths[layer],angle=Math.random()*Math.PI*2,radius=depth*(.55+Math.random()*.45);
  positions[i*3]=Math.cos(angle)*radius;
  positions[i*3+1]=(Math.random()-.5)*(type==='birds'?9:type==='insects'?7:22);
  positions[i*3+2]=Math.sin(angle)*radius;
  velocities[i]=(.35+Math.random()*.85)*layerSpeed[layer];
  drift[i]=Math.random()*6.28;
  sizes[i]=(.65+Math.random()*.65)*(layer===0?1.12:layer===2?.78:1);
  const palette=type==='birds'?['#101923','#263744','#44505a']:type==='insects'?['#f7db77','#f4eecc','#c8e99b']:type==='dust'?['#fff4d9','#e8e3d7','#c6d7e1']:type==='leaves'?['#bd6a22','#e7b454','#a94a21','#a4a04d']:type==='snow'?['#ffffff','#e7f5ff']:['#a5c8e5','#d4e9f9'];
  const color=new THREE.Color(palette[Math.floor(Math.random()*palette.length)]);
  colors[i*3]=color.r;colors[i*3+1]=color.g;colors[i*3+2]=color.b;
 };
 for(let i=0;i<count;i++)randomize(i);
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.BufferAttribute(positions,3));geo.setAttribute('color',new THREE.BufferAttribute(colors,3));geo.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
 const mat=new THREE.ShaderMaterial({
 uniforms:{uTime:{value:0},uRatio:{value:Math.min(devicePixelRatio||1,2)},uOpacity:{value:opacity},uWind:{value:wind}},
 vertexShader:'attribute vec3 color;attribute float aSize;uniform float uRatio;varying vec3 vColor;varying float vFade;void main(){vColor=color;vec4 mv=modelViewMatrix*vec4(position,1.0);float d=max(1.0,-mv.z);vFade=smoothstep(1.0,3.0,d)*(1.0-smoothstep(22.0,31.0,d));gl_Position=projectionMatrix*mv;gl_PointSize=clamp('+ (type==='rain'?'13.0':type==='snow'?'24.0':type==='dust'?'28.0':type==='insects'?'58.0':type==='birds'?'210.0':'31.0') +'*aSize*uRatio*8.0/d,3.0,'+(type==='birds'?'115.0':type==='insects'?'45.0':type==='dust'?'28.0':'35.0')+');}',
 fragmentShader:'precision mediump float;varying vec3 vColor;varying float vFade;uniform float uTime;uniform float uOpacity;void main(){vec2 p=gl_PointCoord*2.0-1.0;float a=0.0;'+(type==='rain'?'a=(1.0-smoothstep(.07,.20,abs(p.x+p.y*.17)))*(1.0-smoothstep(.7,1.0,abs(p.y)))*.6;':type==='snow'?'a=(1.0-smoothstep(.25,.95,length(p)))*.85;':type==='dust'?'float r=length(p);float halo=1.0-smoothstep(.12,.95,r);float core=1.0-smoothstep(.02,.32,r);a=(halo*.42+core*.42)*(.78+.22*sin(uTime*1.4+p.x*13.0));':type==='insects'?'float wing=abs(p.y-.25*sin(uTime*24.0+p.x*4.0));float body=1.0-smoothstep(.08,.25,length(p*vec2(1.4,1.0)));float wings=(1.0-smoothstep(.06,.17,wing))* (1.0-smoothstep(.55,.88,abs(p.x)));a=max(body,wings*.68);':type==='birds'?'float flap=sin(uTime*5.0);float wings=abs(p.y-(.08+.35*abs(p.x))*flap);a=(1.0-smoothstep(.045,.13,wings))*(1.0-smoothstep(.65,.92,abs(p.x)));a=max(a,1.0-smoothstep(.06,.18,length(p*vec2(2.8,1.0))));':'float t=uTime*.6;mat2 r=mat2(cos(t),-sin(t),sin(t),cos(t));vec2 q=r*p;a=(1.0-smoothstep(.55,.85,length(vec2(q.x*1.2,q.y*.8))))*.9;')+'if(a<.015)discard;gl_FragColor=vec4(vColor,a*vFade*uOpacity);}',
 transparent:true,depthWrite:false,depthTest:type!=='birds'&&type!=='insects'
 });
 const particles=new THREE.Points(geo,mat);particles.frustumCulled=false;particles.layers.enableAll();particles.renderOrder=12;scene.add(particles);
 let prev=0;
 function update(time,camera){
  if(!prev){prev=time;return}const dt=Math.min(.05,(time-prev)/1000);prev=time;
  mat.uniforms.uTime.value=time*.001;if(camera){camera.getWorldPosition(particles.position)}
  for(let i=0;i<count;i++){
   const n=i*3;positions[n+1]+=dt*speed*velocities[i]*(type==='birds'?.3:type==='insects'?.3:type==='dust'?.12:-(type==='rain'?17:type==='snow'?2:3));
   positions[n]+=(Math.sin(time*(type==='insects'?.003:type==='birds'?.0004:.0006)+drift[i])*(type==='insects'?2.5:type==='birds'?1.5:type==='dust'?.4:type==='rain'?.5:type==='snow'?1.1:2.8)+wind+(type==='birds'?3:0))*dt*speed;positions[n+2]+=Math.cos(time*(type==='insects'?.002:.0004)+drift[i])*dt*(type==='birds'?2:type==='insects'?1.7:type==='leaves'?1.2:.25);
   if(positions[n+1]<-11||positions[n+1]>11||Math.abs(positions[n])>24||Math.abs(positions[n+2])>24){const layer=i%3,depth=layerDepths[layer],angle=Math.random()*Math.PI*2,radius=depth*(.55+Math.random()*.45);positions[n+1]=type==='birds'?(Math.random()-.5)*9:type==='insects'?(Math.random()-.5)*7:type==='dust'?(Math.random()-.5)*18:11;positions[n]=Math.cos(angle)*radius;positions[n+2]=Math.sin(angle)*radius}
  }geo.attributes.position.needsUpdate=true;
 }
 function dispose(){scene.remove(particles);geo.dispose();mat.dispose()}
 return {update,dispose};
}
