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
  `// Multi-scale, non-periodic microfacets: drifting streaks, occasional pin glints.
   vec2 uv=vec2(fract(vUv.x),vUv.y);
   float t=uTime;
   vec2 a=uv*vec2(430.,135.);
   float warp=noise(a*.025+vec2(t*.018,-t*.009))-.5;
   vec2 q=a+vec2(warp*13.,noise(a*.055-vec2(t*.012,t*.006))*7.);
   float large=noise(q*.11+vec2(t*.036,t*.008));
   float medium=noise(q*.38+vec2(-t*.11,t*.028));
   float fine=noise(q*1.7+vec2(t*.21,-t*.04));
   float broken=noise(q*.76+vec2(-t*.07,t*.09));
   float band=smoothstep(.47,.76,large*.49+medium*.38+fine*.13);
   float glint=smoothstep(.72,.92,medium*.38+fine*.44+broken*.18);
   float pin=smoothstep(.86,.97,fine*.48+broken*.35+large*.17);
   float envelope=.48+.52*noise(uv*vec2(15.,8.)+vec2(t*.006,0.));
   alpha=(.018+band*.22+glint*.33+pin*.34)*envelope;
   alpha*=.8+.2*sin(t*.23+large*8.);
  `);
 // Flow effects are confined to user-drawn panorama masks; never animate the whole image.
 const flowLayer=(name,intensity,speed,color,fragment)=>{
  if(mask(name).length<3)return;
  const maskTexture=texture(name),geometry=new THREE.SphereGeometry(99,96,48);
  const material=new THREE.ShaderMaterial({
   uniforms:{uTime:{value:0},uMask:{value:maskTexture},uOpacity:{value:intensity},uSpeed:{value:speed},uColor:{value:new THREE.Color(color)}},
   vertexShader:`varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`precision highp float;varying vec2 vUv;uniform sampler2D uMask;uniform float uTime,uOpacity,uSpeed;uniform vec3 uColor;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
    void main(){float alpha=0.;float t=uTime*uSpeed;vec2 uv=vec2(fract(vUv.x),vUv.y); ${fragment}
     float region=texture2D(uMask,vUv).r;gl_FragColor=vec4(uColor,clamp(alpha*region*uOpacity,0.,.78));}`,
   side:THREE.BackSide,transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending
  });
  const mesh=new THREE.Mesh(geometry,material);mesh.layers.enableAll();mesh.renderOrder=13;scene.add(mesh);
  resources.push({mesh,geometry,material,maskTexture});
  updates.push((time,camera)=>{material.uniforms.uTime.value=time*.001;camera.getWorldPosition(mesh.position)});
 };
 if(settings.riverFlow)flowLayer('river',clamp(settings.riverIntensity??65,0,100)/100*clamp(settings.riverOpacity??100,0,100)/100,clamp(settings.riverSpeed??1,0.1,5),'#b9dce6',
  `vec2 p=uv*vec2(190.,110.);
   float bend=(noise(p*.045+vec2(t*.08,0.))-.5)*5.;
   p.y+=bend;
   p.x+=t*4.5;
   float streak=noise(vec2(p.x*.65,p.y*.075)+vec2(t*.6,0.));
   float fine=noise(vec2(p.x*2.2,p.y*.3)+vec2(t*1.8,0.));
   float bands=smoothstep(.54,.85,streak*.72+fine*.28);
   float ripple=pow(max(0.,sin(p.x*.28+noise(p*.04)*6.)),12.)*.12;
   alpha=.055+bands*.48+ripple;`);
 if(settings.waterfallFlow)flowLayer('waterfall',clamp(settings.waterfallIntensity??75,0,100)/100*clamp(settings.waterfallOpacity??100,0,100)/100,clamp(settings.waterfallSpeed??1.4,0.1,5),'#d4f1f6',
  `vec2 p=uv*vec2(240.,130.);
   float warp=(noise(vec2(p.x*.08,p.y*.025-t*.06))-.5)*8.;
   float stream=noise(vec2((p.x+warp)*.18,p.y*.018-t*.13));
   float spray=noise(vec2(p.x*1.8,p.y*.7-t*7.));
   float strands=pow(max(0.,sin(p.x*.9+warp+p.y*.08-t*.9)),8.);
   float foam=smoothstep(.58,.84,spray)*.35;
   float falling=noise(vec2(p.x*.36,p.y*.08-t*1.5));
   alpha=.16+stream*.42+strands*.52+foam+falling*.22;`);
 if(settings.clouds)makeLayer('sky',clamp(settings.cloudDensity??35,0,100)/100,'#c7d1d9',
  `vec2 p=vUv*vec2(9.,5.);float n=noise(p+vec2(uTime*.009,0.))* .6+noise(p*2.7+vec2(uTime*.018,0.))*.4;alpha=smoothstep(.34,.67,n)*.58;`);
 if(settings.stars){
  // Individual stars are positioned over the entire spherical sky, not one UV tile.
  // A seeded catalogue keeps the distribution stable between panorama visits.
  const skyMask=texture('sky');
  const density=clamp(settings.starDensity??55,0,100)/100;
  const count=Math.round(1700*density),positions=new Float32Array(count*3),twinkle=new Float32Array(count),sizes=new Float32Array(count);
  const sample=document.createElement('canvas');sample.width=512;sample.height=256;
  const sampleCtx=sample.getContext('2d');sampleCtx.drawImage(skyMask.image,0,0,512,256);
  const maskPixels=sampleCtx.getImageData(0,0,512,256).data;
  let seed=1987291;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
  for(let i=0;i<count;i++){
   let yaw=0,pitch=0,valid=false;
   for(let k=0;k<100;k++){
    yaw=rand()*360-180;
    pitch=Math.asin(rand()*2-1)*180/Math.PI;
    const x=Math.min(511,Math.max(0,Math.floor((yaw+180)/360*512)));
    const y=Math.min(255,Math.max(0,Math.floor((90-pitch)/180*256)));
    if(maskPixels[(y*512+x)*4]>127){valid=true;break}
   }
   if(!valid){positions[i*3]=1e5;positions[i*3+1]=1e5;positions[i*3+2]=1e5;continue}
   const a=THREE.MathUtils.degToRad(yaw),b=THREE.MathUtils.degToRad(pitch);
   positions[i*3]=80*Math.cos(b)*Math.cos(a);
   positions[i*3+1]=80*Math.sin(b);
   positions[i*3+2]=-80*Math.cos(b)*Math.sin(a);
   twinkle[i]=rand()*6.283185;
   sizes[i]=rand()<.94?.7+rand()*.6:1.4+rand()*1.1;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('aPhase',new THREE.BufferAttribute(twinkle,1));
  geometry.setAttribute('aSize',new THREE.BufferAttribute(sizes,1));
  const material=new THREE.ShaderMaterial({
   uniforms:{uTime:{value:0},uOpacity:{value:.45+.55*density}},
   vertexShader:`precision mediump float;attribute float aPhase;attribute float aSize;uniform float uTime;varying float vAlpha;void main(){vec4 mv=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*mv;gl_PointSize=clamp(aSize*2.2,1.,5.);vAlpha=.62+.25*sin(uTime*(.35+fract(aPhase)*.6)+aPhase);}`,
   fragmentShader:`precision mediump float;uniform float uOpacity;varying float vAlpha;void main(){vec2 d=gl_PointCoord-.5;float r=length(d);float alpha=(1.-smoothstep(.05,.5,r))*vAlpha*uOpacity;if(alpha<.01)discard;gl_FragColor=vec4(.83,.9,1.,alpha);}`,
   transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending
  });
  const stars=new THREE.Points(geometry,material);stars.layers.enableAll();stars.frustumCulled=false;scene.add(stars);
  resources.push({mesh:stars,geometry,material,maskTexture:skyMask});
  updates.push((time,camera)=>{material.uniforms.uTime.value=time*.001;camera.getWorldPosition(stars.position)});
 }
 if(settings.lightBeams)makeLayer('light',clamp(settings.beamIntensity??40,0,100)/100,'#ffe6b5',
  `float center=(${Number(settings.sunYaw||0).toFixed(2)}+180.)/360.;float dx=abs(fract(vUv.x-center+.5)-.5);float rays=pow(max(0.,sin(dx*390.+sin(vUv.y*13.)*1.5)),14.);float cone=exp(-dx*dx*150.)*smoothstep(.1,.65,vUv.y);alpha=(.12+rays*.38)*cone;`);
 if(settings.lampGlow){
  const lamps=Array.isArray(settings.lamps)?settings.lamps.filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)).slice(0,20):[];
  // Two independently textured glows: a broad soft halo and a compact bright core.
  const makeGlowTexture=(core)=>{
   const c=document.createElement('canvas');c.width=c.height=256;
   const ctx=c.getContext('2d'),g=ctx.createRadialGradient(128,128,0,128,128,127);
   if(core){g.addColorStop(0,'rgba(255,251,226,1)');g.addColorStop(.08,'rgba(255,238,190,.94)');g.addColorStop(.23,'rgba(255,205,120,.42)');g.addColorStop(.65,'rgba(255,172,90,.07)');}
   else{g.addColorStop(0,'rgba(255,223,166,.58)');g.addColorStop(.14,'rgba(255,207,144,.36)');g.addColorStop(.48,'rgba(255,185,116,.12)');}
   g.addColorStop(1,'rgba(255,170,100,0)');
   ctx.fillStyle=g;ctx.fillRect(0,0,256,256);
   return new THREE.CanvasTexture(c);
  };
  const haloTexture=makeGlowTexture(false),coreTexture=makeGlowTexture(true);
  resources.push({maskTexture:haloTexture},{maskTexture:coreTexture});
  const intensity=clamp(settings.lampIntensity??60,0,100)/100;
  for(const [yaw,pitch] of lamps){
   const a=THREE.MathUtils.degToRad(yaw),b=THREE.MathUtils.degToRad(pitch);
   const direction=new THREE.Vector3(Math.cos(b)*Math.cos(a),Math.sin(b),-Math.cos(b)*Math.sin(a));
   const makeSprite=(map,scale,opacity)=>{
    const material=new THREE.SpriteMaterial({map,color:0xffffff,transparent:true,depthTest:false,depthWrite:false,opacity,blending:THREE.AdditiveBlending});
    const sprite=new THREE.Sprite(material);
    sprite.position.copy(direction).multiplyScalar(90);
    sprite.scale.set(scale,scale,1);sprite.layers.enableAll();sprite.renderOrder=35;
    scene.add(sprite);resources.push({mesh:sprite,material});
    updates.push((time,camera)=>{
     camera.getWorldPosition(sprite.position);
     sprite.position.addScaledVector(direction,90);
     material.opacity=opacity*(.96+.04*Math.sin(time*.0014+yaw));
    });
   };
   makeSprite(haloTexture,38,intensity*.85);
   makeSprite(coreTexture,13,Math.min(1,intensity*1.3));
  }
 }
 // 10: distinct animated bubble rings and soft rising steam plumes.
 // The fallback covers the lower hemisphere when no explicit mask has been drawn.
 const hasMask=name=>mask(name).length>=3;
 const makeSourceLayer=(name,opacity,color,shader)=>{
  const maskTexture=texture(name),geometry=new THREE.SphereGeometry(120,96,48);
  const material=new THREE.ShaderMaterial({
   uniforms:{uTime:{value:0},uMask:{value:maskTexture},uOpacity:{value:opacity},uColor:{value:new THREE.Color(color)},uHasMask:{value:hasMask(name)?1:0}},
   vertexShader:`precision highp float;varying vec2 vUv;void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
   fragmentShader:`precision highp float;varying vec2 vUv;uniform sampler2D uMask;uniform float uTime,uOpacity,uHasMask;uniform vec3 uColor;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
    void main(){float alpha=0.;${shader}
     float region=mix(smoothstep(.52,.44,vUv.y),texture2D(uMask,vUv).r,uHasMask);
     gl_FragColor=vec4(uColor,clamp(alpha*region*uOpacity,0.,.85));}`,
   side:THREE.BackSide,transparent:true,depthWrite:false,depthTest:false,blending:THREE.AdditiveBlending
  });
  const mesh=new THREE.Mesh(geometry,material);mesh.layers.enableAll();mesh.renderOrder=22;scene.add(mesh);
  resources.push({mesh,geometry,material,maskTexture});
  updates.push((time,camera)=>{material.uniforms.uTime.value=time*.001;camera.getWorldPosition(mesh.position)});
 };
 if(settings.bubbles)makeSourceLayer('bubbles',clamp(settings.bubbleIntensity??50,0,100)/100,'#d4f2ff',
  `vec2 grid=vec2(92.,44.);vec2 uv=vec2(fract(vUv.x),vUv.y);
   vec2 id=floor(uv*grid);float h=hash(id);float spawn=step(.72,h);
   float speed=.10+.12*hash(id+17.);float age=fract(uTime*speed+hash(id+3.));
   vec2 local=fract(uv*grid)-.5;
   vec2 center=vec2(.18*sin(uTime*.45+h*10.),.5-age);
   float radius=.095+.13*hash(id+11.);
   float d=length((local-center)*vec2(1.,1.1));
   float ring=1.-smoothstep(.012,.045,abs(d-radius));
   float core=(1.-smoothstep(.0,.08,d))*.24;
   alpha=spawn*(ring*.72+core)*(.55+.45*(1.-age));`);
 if(settings.steam)makeSourceLayer('steam',clamp(settings.steamIntensity??45,0,100)/100,'#e8eff0',
  `vec2 p=vUv*vec2(11.,8.);float t=uTime;
   float drift=sin(p.y*1.8+t*.22)*.32;
   float n=noise(p*1.2+vec2(drift,-t*.13))*.6+noise(p*3.3+vec2(-t*.07,-t*.31))*.4;
   float body=smoothstep(.32,.67,n);
   float slow=noise(p*.42+vec2(t*.018,-t*.05));
   alpha=body*(.22+.52*slow);`);
 // 11: transparent time-of-day grading; avoids pretending to replace daytime skies.
 if(settings.timeOfDay){
  const stage=clamp(settings.dayPhase??65,0,100)/100;
  const warm=Math.exp(-Math.pow((stage-.48)/.19,2));
  const dark=THREE.MathUtils.smoothstep(stage,.58,1);
  const color=new THREE.Color('#f8aa67').lerp(new THREE.Color('#20395b'),dark);
  makeLayer('all',Math.max(.05,.18*warm+.55*dark),color,
   `alpha=.55;`);
 }
 // 12: slowly drifting isolated leaves, limited to a user-drawn water region.
 if(settings.floatingLeaves)makeLayer('floating',clamp(settings.floatingDensity??40,0,100)/100,'#c7a16b',
  `vec2 p=vUv*vec2(100.,45.);p.x+=uTime*.028;p.y+=sin(p.x*.4+uTime*.11)*.09;
   vec2 id=floor(p),q=fract(p)-.5;float h=hash(id);
   float selected=step(.93,h);float angle=h*6.283+sin(uTime*.19+h*10.)*.3;
   vec2 r=vec2(cos(angle)*q.x-sin(angle)*q.y,sin(angle)*q.x+cos(angle)*q.y);
   float leaf=1.-smoothstep(.0,.08,length(r*vec2(1.6,3.2))-.22);
   alpha=selected*leaf*.55;`);
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
