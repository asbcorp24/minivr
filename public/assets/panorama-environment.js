import * as THREE from '/assets/vendor/three/three.module.js';
// Camera-centred equirectangular overlays; masks are longitude/latitude polygons in degrees.
export function createEnvironment(scene,settings={}){
 const resources=[],updates=[];
 const clamp=(v,a,b)=>Math.min(b,Math.max(a,Number(v)||0));
 const mask=(name)=>{
  const p=settings.masks?.[name];
  if(!Array.isArray(p)||p.length<3)return [];
  return p.filter(x=>Array.isArray(x)&&x.length===2&&x.every(Number.isFinite)).slice(0,80);
 };
 const texture=(name)=>{
  const cv=document.createElement('canvas');cv.width=512;cv.height=256;const c=cv.getContext('2d');
  const p=mask(name);if(p.length<3){c.fillStyle='#fff';c.fillRect(0,0,512,256)}
  else{
   c.fillStyle='#fff';for(const shift of [-512,0,512]){c.beginPath();p.forEach(([yaw,pitch],i)=>{const x=(yaw+180)/360*512+shift,y=(90-pitch)/180*256;if(!i)c.moveTo(x,y);else c.lineTo(x,y)});c.closePath();c.fill()}
  }
  const t=new THREE.CanvasTexture(cv);t.wrapS=THREE.RepeatWrapping;t.minFilter=THREE.LinearFilter;return t;
 };
 const makeLayer=(name,opacity,color,fragment)=>{
  const maskTexture=texture(name),geometry=new THREE.SphereGeometry(100,64,32);
  const material=new THREE.ShaderMaterial({
   uniforms:{uTime:{value:0},uMask:{value:maskTexture},uOpacity:{value:opacity},uColor:{value:new THREE.Color(color)}},
   vertexShader:`precision highp float;varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`precision highp float;varying vec2 vUv;uniform sampler2D uMask;uniform float uTime;uniform float uOpacity;uniform vec3 uColor;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
    void main(){float maskAlpha=texture2D(uMask,vUv).r;float alpha=0.;${fragment}
    gl_FragColor=vec4(uColor,clamp(alpha*maskAlpha*uOpacity,0.,.65));}`,
   side:THREE.BackSide,transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending
  });
  const mesh=new THREE.Mesh(geometry,material);mesh.layers.enableAll();mesh.renderOrder=8;scene.add(mesh);
  resources.push({mesh,geometry,material,maskTexture});
  updates.push((time,camera)=>{material.uniforms.uTime.value=time*.001;camera.getWorldPosition(mesh.position)});
 };
 if(settings.liveWater)makeLayer('water',clamp(settings.waterShimmer??35,0,100)/100,'#9ab9cf',
  `vec2 p=vUv*vec2(210.,90.);float n=noise(vec2(p.x*.23+uTime*.15,p.y*.35));float wave=sin(p.y*1.7+sin(p.x*.4+uTime*.3)*1.5+uTime*.65);float sparkle=smoothstep(.58,.82,n*.55+wave*.23+.25);alpha=.035+.45*sparkle;`);
 if(settings.clouds)makeLayer('sky',clamp(settings.cloudDensity??35,0,100)/100,'#c7d1d9',
  `vec2 p=vUv*vec2(9.,5.);float n=noise(p+vec2(uTime*.009,0.))* .6+noise(p*2.7+vec2(uTime*.018,0.))*.4;alpha=smoothstep(.34,.67,n)*.58;`);
 if(settings.stars)makeLayer('sky',clamp(settings.starDensity??55,0,100)/100,'#dce8ff',
  `vec2 p=floor(vUv*vec2(1100.,520.));float h=hash(p);float star=step(.994,h);float flicker=.7+.3*sin(uTime*(.5+hash(p+2.)*2.)+h*40.);alpha=star*flicker*1.0;`);
 if(settings.lightBeams)makeLayer('light',clamp(settings.beamIntensity??40,0,100)/100,'#ffe6b5',
  `float center=(${Number(settings.sunYaw||0).toFixed(2)}+180.)/360.;float dx=abs(fract(vUv.x-center+.5)-.5);float rays=pow(max(0.,sin(dx*390.+sin(vUv.y*13.)*1.5)),14.);float cone=exp(-dx*dx*150.)*smoothstep(.1,.65,vUv.y);alpha=(.12+rays*.38)*cone;`);
 if(settings.lampGlow){
  const lamps=Array.isArray(settings.lamps)?settings.lamps.slice(0,20):[];
  const c=document.createElement('canvas');c.width=c.height=128;const ctx=c.getContext('2d'),g=ctx.createRadialGradient(64,64,1,64,64,63);
  g.addColorStop(0,'rgba(255,239,193,.85)');g.addColorStop(.17,'rgba(255,209,139,.35)');g.addColorStop(1,'rgba(255,193,110,0)');ctx.fillStyle=g;ctx.fillRect(0,0,128,128);
  const t=new THREE.CanvasTexture(c);
  for(const [yaw,pitch] of lamps){const a=THREE.MathUtils.degToRad(yaw),b=THREE.MathUtils.degToRad(pitch);
   const m=new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false,depthWrite:false,opacity:clamp(settings.lampIntensity??60,0,100)/100,blending:THREE.AdditiveBlending});
   const sp=new THREE.Sprite(m);sp.position.set(90*Math.cos(b)*Math.cos(a),90*Math.sin(b),-90*Math.cos(b)*Math.sin(a));sp.scale.set(11,11,1);sp.layers.enableAll();scene.add(sp);resources.push({mesh:sp,material:m});
  }
  resources.push({maskTexture:t});
 }
 if(settings.windLeaves){
  const polygon=mask('vegetation'),count=Math.round(clamp(settings.leafDensity??30,0,100)*2.5);
  if(polygon.length>=3&&count){
   const positions=new Float32Array(count*3),velocities=new Float32Array(count),sizes=new Float32Array(count);
   const bounds=[Math.min(...polygon.map(p=>p[0])),Math.max(...polygon.map(p=>p[0])),Math.min(...polygon.map(p=>p[1])),Math.max(...polygon.map(p=>p[1]))];
   const inside=(x,y)=>{let hit=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){const a=polygon[i],b=polygon[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit}return hit};
   for(let i=0;i<count;i++){let x=0,y=0;for(let j=0;j<60;j++){x=bounds[0]+Math.random()*(bounds[1]-bounds[0]);y=bounds[2]+Math.random()*(bounds[3]-bounds[2]);if(inside(x,y))break}velocities[i]=Math.random()*6.28;sizes[i]=2+Math.random()*3;const a=THREE.MathUtils.degToRad(x),b=THREE.MathUtils.degToRad(y);positions[i*3]=25*Math.cos(b)*Math.cos(a);positions[i*3+1]=25*Math.sin(b);positions[i*3+2]=-25*Math.cos(b)*Math.sin(a)}
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('aPhase',new THREE.BufferAttribute(velocities,1));geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
   const material=new THREE.ShaderMaterial({uniforms:{uTime:{value:0},uWind:{value:clamp(settings.wind??0,-8,8)}},
    vertexShader:'precision mediump float;attribute float aPhase;attribute float aSize;uniform float uTime;uniform float uWind;varying float vAlpha;void main(){vec3 p=position;p.x+=sin(uTime*.7+aPhase)*.35+uTime*uWind*.015;p.y+=sin(uTime*.4+aPhase)*.22;vec4 mv=modelViewMatrix*vec4(p,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*18./max(1.,-mv.z),1.,7.);vAlpha=.45+.25*sin(uTime+aPhase);}',
    fragmentShader:'precision mediump float;varying float vAlpha;void main(){vec2 p=gl_PointCoord-.5;if(length(p)>.48)discard;gl_FragColor=vec4(.67,.49,.23,vAlpha);}',
    transparent:true,depthWrite:false,depthTest:false});
   const points=new THREE.Points(geometry,material);points.layers.enableAll();points.frustumCulled=false;scene.add(points);resources.push({mesh:points,geometry,material});
   updates.push((time,camera)=>{material.uniforms.uTime.value=time*.001;camera.getWorldPosition(points.position)});
  }
 }
 return {update(t,c){for(const fn of updates)fn(t,c)},dispose(){for(const r of resources){if(r.mesh)scene.remove(r.mesh);r.geometry?.dispose();r.material?.dispose();r.maskTexture?.dispose()}}};
}
