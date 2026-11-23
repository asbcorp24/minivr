import * as THREE from '/assets/vendor/three/three.module.js';
import {sampleDepthRadius} from '/assets/depth-tile-geometry.js';
import {makeTileFoliageMask} from '/assets/tile-foliage-mask.js';
import {seamBlurAmount,blendSeamTilePixels} from '/assets/panorama-seam-blur.js';
/* Independent tiled panorama layer. Never modifies Cardboard renderer or eye cameras. */
export async function createTiledPanorama({url,scene,camera,renderer,mirror=false,manifest:cachedManifest=null,baseTiles=null,depth=null,foliage=null,seamBlur=0}){
 const response=cachedManifest?null:await fetch(url,{credentials:'same-origin'});
 if(response&&!response.ok)throw Error('Tiles manifest HTTP '+response.status);
 const manifest=cachedManifest||await response.json();if(manifest.projection!=='360'||!Array.isArray(manifest.levels)||!manifest.levels.length)throw Error('Invalid tile manifest');
 const base=url.slice(0,url.lastIndexOf('/')+1),group=new THREE.Group();scene.add(group);
 const loader=new THREE.TextureLoader(),tiles=new Map(),pending=new Set(),maxConcurrent=8;
 let disposed=false;
 const seamStrength=seamBlurAmount(seamBlur);
 // The manual 512x256 mask is shared across all LODs; automatic masks are
 // created from each decoded JPEG tile, so the full panorama is never decoded.
 const wind=foliage?.enabled?{
  phase:{value:0},strength:{value:foliage.preview?1:THREE.MathUtils.clamp(Number(foliage.strength??60),0,100)/100},
  speed:THREE.MathUtils.clamp(Number(foliage.speed??1),.1,5)
 }:null;
 let manualWindMask=null,maskWarningShown=false;
 if(wind&&foliage.manualMask){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=256;
  canvas.getContext('2d').drawImage(foliage.manualMask,0,0,512,256);
  manualWindMask=new THREE.CanvasTexture(canvas);
  manualWindMask.wrapS=THREE.RepeatWrapping;
  manualWindMask.minFilter=THREE.LinearFilter;
  manualWindMask.magFilter=THREE.LinearFilter;
 }
 // One 256×128 atlas is shared by every tile and every depth band. Image
 // resolution, however, is selected independently by the normal tile LOD.
 const depthAtlas=depth?.bands>0?new THREE.DataTexture(new Uint8Array(depth.pixels),256,128,THREE.RGBAFormat,THREE.UnsignedByteType):null;
 if(depthAtlas){depthAtlas.wrapS=THREE.RepeatWrapping;depthAtlas.minFilter=THREE.LinearFilter;depthAtlas.magFilter=THREE.LinearFilter;depthAtlas.needsUpdate=true;}
 const geometry=(level,x,y,radiusBias=0,backdrop=false)=>{
  const cols=level.cols,rows=level.rows,sw=level.width,sh=level.height,ts=manifest.tileSize;
  const u0=x*ts/sw,u1=Math.min((x+1)*ts/sw,1),v0=y*ts/sh,v1=Math.min((y+1)*ts/sh,1);
  const segmentsX=depth?Math.max(12,Math.min(36,Math.ceil((u1-u0)*(depth.field.width-1)))):12;
  const segmentsY=depth?Math.max(12,Math.min(36,Math.ceil((v1-v0)*(depth.field.height-1)))):12;
  const g=new THREE.BufferGeometry(),positions=[],uvs=[],indices=[];
  for(let j=0;j<=segmentsY;j++)for(let i=0;i<=segmentsX;i++){
   const u=u0+(u1-u0)*i/segmentsX,v=v0+(v1-v0)*j/segmentsY;
   const theta=(mirror?1-u:u)*Math.PI*2,phi=v*Math.PI;
   const originalRadius=backdrop?80:depth?sampleDepthRadius(depth.field,mirror?1-u:u,1-v):500;
   const radius=backdrop?originalRadius:Math.max(originalRadius*.85,originalRadius-radiusBias);
   positions.push(-radius*Math.cos(theta)*Math.sin(phi),radius*Math.cos(phi),radius*Math.sin(theta)*Math.sin(phi));
   uvs.push(i/segmentsX,1-j/segmentsY);
  }
  for(let j=0;j<segmentsY;j++)for(let i=0;i<segmentsX;i++){const k=j*(segmentsX+1)+i;indices.push(k,k+segmentsX+1,k+1,k+1,k+segmentsX+1,k+segmentsX+2)}
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);return g;
 };
 // Reproduce the existing hybrid band weights on the GPU instead of uploading
 // a full-size transparent panorama texture separately for every depth band.
 function bandMaterial(texture,level,x,y,band){
  const count=depth.bands,foreground=band/(count-1),center=(band+.5)/count;
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,transparent:true,depthWrite:false,alphaTest:depth.relief?.055:.015});
  const transform=new THREE.Vector4(x*manifest.tileSize/level.width,y*manifest.tileSize/level.height,
   Math.min(manifest.tileSize/level.width,1-x*manifest.tileSize/level.width),
   Math.min(manifest.tileSize/level.height,1-y*manifest.tileSize/level.height));
  material.onBeforeCompile=shader=>{
   shader.uniforms.depthAtlas={value:depthAtlas};
   shader.uniforms.depthUvTransform={value:transform};
   shader.uniforms.depthBand={value:new THREE.Vector4(center,1/count,depth.nonlinear,1+depth.occlusion*foreground*2.2)};
   shader.vertexShader=shader.vertexShader.replace('void main() {','varying vec2 vDepthTileUv; uniform vec4 depthUvTransform;\nvoid main() {')
    .replace('#include <uv_vertex>','#include <uv_vertex>\n vDepthTileUv = depthUvTransform.xy + vec2(uv.x, 1.0 - uv.y) * depthUvTransform.zw;');
   shader.fragmentShader=shader.fragmentShader.replace('void main() {','varying vec2 vDepthTileUv; uniform sampler2D depthAtlas; uniform vec4 depthBand;\nvoid main() {')
    .replace('#include <map_fragment>',`#include <map_fragment>
      float depthValue = texture2D(depthAtlas, vDepthTileUv).r;
      depthValue = mix(depthValue, pow(depthValue, 2.2), depthBand.z);
      float coverage = clamp((depthBand.y - abs(depthValue - depthBand.x)) / (depthBand.y * 0.5), 0.0, 1.0);
      diffuseColor.a *= pow(coverage, depthBand.w);`);
  };
  material.customProgramCacheKey=()=> 'minivr-depth-tiles-v1';
  return material;
 }
 function makeAutomaticWindMask(texture){
  const image=texture.image;
  if(!image?.width||!image?.height)return null;
  const canvas=document.createElement('canvas');
  canvas.width=Math.min(128,image.width);canvas.height=Math.min(128,image.height);
  const ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.drawImage(image,0,0,canvas.width,canvas.height);
  const frame=ctx.getImageData(0,0,canvas.width,canvas.height);
  frame.data.set(makeTileFoliageMask(frame.data,canvas.width,canvas.height));
  ctx.putImageData(frame,0,0);
  const mask=new THREE.CanvasTexture(canvas);
  mask.minFilter=THREE.LinearFilter;mask.magFilter=THREE.LinearFilter;
  return mask;
 }
 function installTileWind(material,level,x,y,band,mask){
  if(!wind||!mask||depth?.bands>0&&!manualWindMask&&band<depth.bands-2)return;
  const manual=!!manualWindMask,showMask=!!foliage.showMask;
  const strength=manual?1:((depth?.bands??0)>0 ? .38+.62*band/Math.max(1,depth.bands-1) : 1);
  const transform=new THREE.Vector4(x*manifest.tileSize/level.width,y*manifest.tileSize/level.height,
   Math.min(manifest.tileSize/level.width,1-x*manifest.tileSize/level.width),
   Math.min(manifest.tileSize/level.height,1-y*manifest.tileSize/level.height));
  const previous=material.onBeforeCompile;
  material.onBeforeCompile=shader=>{
   previous?.(shader);
   shader.uniforms.microMotionTime=wind.phase;
   shader.uniforms.microMotionStrength=wind.strength;
   shader.uniforms.microMotionBandWeight={value:strength};
   shader.uniforms.foliageWindMask={value:mask};
   shader.uniforms.foliageTileUv={value:transform};
   shader.fragmentShader=`uniform float microMotionTime;
uniform float microMotionStrength;
uniform float microMotionBandWeight;
uniform sampler2D foliageWindMask;
uniform vec4 foliageTileUv;\n`+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
#ifdef USE_MAP
  vec2 windUv = vMapUv;
  // Global longitude makes the wind phase agree between neighbouring tiles.
  vec2 panoramaUv = vec2(foliageTileUv.x + windUv.x * foliageTileUv.z,
                         foliageTileUv.y + (1.0 - windUv.y) * foliageTileUv.w);
  float windMask = texture2D(foliageWindMask,${manual?'vec2(panoramaUv.x,1.0-panoramaUv.y)':'windUv'}).${manual?'a':'r'};
  windMask = smoothstep(0.025,0.32,windMask);
  // Zero displacement at tile boundaries prevents disjoint samples and
  // guarantees a stable 0°/360° seam even at mixed LODs.
  float edgeDistance = min(min(windUv.x,1.0-windUv.x),min(windUv.y,1.0-windUv.y));
  float tileEdge = smoothstep(0.0,0.025,edgeDistance);
  float phaseA = microMotionTime*1.3 + panoramaUv.y*34.0 + sin(panoramaUv.x*37.6991118);
  float phaseB = microMotionTime*.8 + sin(panoramaUv.x*50.2654824);
  vec2 windShift = vec2(sin(phaseA)*.006 + sin(phaseB)*.002,cos(phaseB)*.003);
  float gust = .72 + .18*sin(microMotionTime*.31 + panoramaUv.x*6.2831853*2.0)
                   + .10*sin(microMotionTime*.17 - panoramaUv.y*9.0);
  windUv += windShift*windMask*microMotionStrength*microMotionBandWeight*gust*tileEdge;
  vec4 sampledDiffuseColor = texture2D(map,clamp(windUv,vec2(0.0),vec2(1.0)));
  diffuseColor *= sampledDiffuseColor;
  ${showMask?'diffuseColor.rgb = mix(diffuseColor.rgb,vec3(1.0,.1,.75),windMask*.8);':''}
#endif
  `);
  };
  const originalKey=material.customProgramCacheKey;
  material.customProgramCacheKey=()=>`${originalKey?.call(material)||'tile'}-foliage-v1-${manual?'manual':'auto'}-${showMask?'mask':'normal'}`;
 }
 function removeTile(item){
  for(const mesh of item.meshes){group.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
  item.windMask?.dispose();
  item.texture.dispose();
 }
 function blendLoadedSeam(level,y){
  if(!seamStrength)return;
  const left=tiles.get(level.level+':0:'+y);
  const right=tiles.get(level.level+':'+(level.cols-1)+':'+y);
  if(!left||!right)return;
  try{
   const a=left.seamSource||left.texture.image,b=right.seamSource||right.texture.image;
   if(!a?.width||!b?.width||a.height!==b.height)return;
   const prepare=image=>{
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const context=canvas.getContext('2d',{willReadFrequently:true});
    context.drawImage(image,0,0,canvas.width,canvas.height);
    return {canvas,context,frame:context.getImageData(0,0,canvas.width,canvas.height)};
   };
   const first=prepare(a),last=left===right?first:prepare(b);
   const radius=blendSeamTilePixels(first.frame.data,a.width,last.frame.data,b.width,a.height,level.width,seamStrength);
   if(!radius)return;
   first.context.putImageData(first.frame,0,0);
   left.texture.image=first.canvas;left.texture.needsUpdate=true;
   if(left!==right){last.context.putImageData(last.frame,0,0);right.texture.image=last.canvas;right.texture.needsUpdate=true;}
  }catch(error){console.warn('MiniVR seam blur unavailable for tile',error)}
 }
 function load(level,x,y){
  const key=level.level+':'+x+':'+y;if(disposed||tiles.has(key)||pending.has(key)||pending.size>=maxConcurrent)return;
  pending.add(key);
  const path=level.level+'/'+x+'_'+y+'.jpg',blob=baseTiles?.get(path);
  const objectUrl=blob?URL.createObjectURL(blob):null;
  const finish=()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);};
  loader.load(objectUrl||base+path,texture=>{
   finish();
   pending.delete(key);if(disposed){texture.dispose();return;}texture.colorSpace=THREE.SRGBColorSpace;
   let windMask=manualWindMask;
   if(wind&&!windMask){
    try{windMask=makeAutomaticWindMask(texture)}catch(error){
     if(!maskWarningShown){console.warn('MiniVR tile foliage mask unavailable',error);maskWarningShown=true;}
    }
   }
   const meshes=[];
   if(depth?.bands>0){
    // Each higher LOD first paints its own original image, covering the lower
    // LOD before its transparent bands are composited. This avoids ghosting.
    const backdrop=new THREE.Mesh(geometry(level,x,y,0,true),new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,transparent:true,depthWrite:false}));
    backdrop.renderOrder=level.level*(depth.bands+1);meshes.push(backdrop);
    for(let band=0;band<depth.bands;band++){
     const bias=depth.occlusion*(band/(depth.bands-1))*1.8;
     const material=bandMaterial(texture,level,x,y,band);
     installTileWind(material,level,x,y,band,windMask);
     const mesh=new THREE.Mesh(geometry(level,x,y,bias),material);
     mesh.renderOrder=level.level*(depth.bands+1)+band+1;meshes.push(mesh);
    }
   }else{
    const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,depthWrite:false});
    installTileWind(material,level,x,y,0,windMask);
    const mesh=new THREE.Mesh(geometry(level,x,y),material);mesh.renderOrder=level.level;meshes.push(mesh);
   }
   for(const mesh of meshes){mesh.frustumCulled=false;group.add(mesh);}
   tiles.set(key,{meshes,texture,seamSource:seamStrength&&[0,level.cols-1].includes(x)?texture.image:null,
    windMask:windMask===manualWindMask?null:windMask,level:level.level,last:performance.now()});
   if(seamStrength&&(x===0||x===level.cols-1))blendLoadedSeam(level,y);
  },undefined,()=>{finish();pending.delete(key)});
 }
 const low=manifest.levels[0];
 const baseQueue=[];for(let y=0;y<low.rows;y++)for(let x=0;x<low.cols;x++)baseQueue.push([x,y]);
 let last=0;
 function update(time=performance.now()){
  if(disposed)return;
  // Animate at display refresh even though LOD selection is throttled.
  if(wind)wind.phase.value=time*.001*wind.speed;
  if(time-last<160)return;last=time;
  for(const [bx,by] of baseQueue)load(low,bx,by);
 const fov=camera.fov||75;
  const idx=Math.max(0,Math.min(manifest.levels.length-1,Math.ceil(Math.log2(100/Math.max(10,fov)))+1));
  const level=manifest.levels[idx];camera.updateMatrixWorld(true);
  const direction=new THREE.Vector3();camera.getWorldDirection(direction);
  const angle=Math.atan2(direction.z,-direction.x),u0=((angle/(Math.PI*2))%1+1)%1,u=mirror?1-u0:u0;
  const v=Math.acos(THREE.MathUtils.clamp(direction.y,-1,1))/Math.PI;
  const x=Math.floor(u*level.width/manifest.tileSize),y=Math.floor(v*level.height/manifest.tileSize);
  // Cover the actual viewport, not a fixed 5x3 neighborhood.
  const horizontalFov=2*Math.atan(Math.tan(THREE.MathUtils.degToRad(fov)*.5)*camera.aspect);
  const horizontalTiles=Math.min(level.cols,Math.ceil(horizontalFov/(Math.PI*2)*level.cols*.6)+2);
  const verticalTiles=Math.min(level.rows,Math.ceil(THREE.MathUtils.degToRad(fov)/Math.PI*level.rows*.6)+2);
  const candidates=[];
  for(let dy=-verticalTiles;dy<=verticalTiles;dy++)for(let dx=-horizontalTiles;dx<=horizontalTiles;dx++){
   const xx=((x+dx)%level.cols+level.cols)%level.cols,yy=y+dy;
   if(yy>=0&&yy<level.rows)candidates.push([xx,yy,dx*dx+dy*dy]);
  }
  candidates.sort((a,b)=>a[2]-b[2]);
  for(const [xx,yy] of candidates)load(level,xx,yy);
  // Keep base layer permanently; remove distant high-resolution tiles to cap GPU memory.
  const now=performance.now();for(const [key,item] of tiles){
   if(item.level===0)continue;
   if(item.level!==level.level||now-item.last>20000){
    removeTile(item);tiles.delete(key);
   }else item.last=now;
  }
 }
 function dispose(){disposed=true;scene.remove(group);for(const item of tiles.values())removeTile(item);tiles.clear();pending.clear();depthAtlas?.dispose();manualWindMask?.dispose();group.clear()}
 return {update,dispose,manifest,group};
}
