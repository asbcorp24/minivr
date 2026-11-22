import * as THREE from '/assets/vendor/three/three.module.js';
import {sampleDepthRadius} from '/assets/depth-tile-geometry.js';
/* Independent tiled panorama layer. Never modifies Cardboard renderer or eye cameras. */
export async function createTiledPanorama({url,scene,camera,renderer,mirror=false,manifest:cachedManifest=null,baseTiles=null,depth=null}){
 const response=cachedManifest?null:await fetch(url,{credentials:'same-origin'});
 if(response&&!response.ok)throw Error('Tiles manifest HTTP '+response.status);
 const manifest=cachedManifest||await response.json();if(manifest.projection!=='360'||!Array.isArray(manifest.levels)||!manifest.levels.length)throw Error('Invalid tile manifest');
 const base=url.slice(0,url.lastIndexOf('/')+1),group=new THREE.Group();scene.add(group);
 const loader=new THREE.TextureLoader(),tiles=new Map(),pending=new Set(),maxConcurrent=8;
 let disposed=false;
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
 function removeTile(item){
  for(const mesh of item.meshes){group.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();}
  item.texture.dispose();
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
   const meshes=[];
   if(depth?.bands>0){
    // Each higher LOD first paints its own original image, covering the lower
    // LOD before its transparent bands are composited. This avoids ghosting.
    const backdrop=new THREE.Mesh(geometry(level,x,y,0,true),new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,transparent:true,depthWrite:false}));
    backdrop.renderOrder=level.level*(depth.bands+1);meshes.push(backdrop);
    for(let band=0;band<depth.bands;band++){
     const bias=depth.occlusion*(band/(depth.bands-1))*1.8;
     const mesh=new THREE.Mesh(geometry(level,x,y,bias),bandMaterial(texture,level,x,y,band));
     mesh.renderOrder=level.level*(depth.bands+1)+band+1;meshes.push(mesh);
    }
   }else{
    const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,depthWrite:false});
    const mesh=new THREE.Mesh(geometry(level,x,y),material);mesh.renderOrder=level.level;meshes.push(mesh);
   }
   for(const mesh of meshes){mesh.frustumCulled=false;group.add(mesh);}
   tiles.set(key,{meshes,texture,level:level.level,last:performance.now()});
  },undefined,()=>{finish();pending.delete(key)});
 }
 const low=manifest.levels[0];
 const baseQueue=[];for(let y=0;y<low.rows;y++)for(let x=0;x<low.cols;x++)baseQueue.push([x,y]);
 let last=0;
 function update(){
  if(disposed)return;
  if(performance.now()-last<160)return;last=performance.now();
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
 function dispose(){disposed=true;scene.remove(group);for(const item of tiles.values())removeTile(item);tiles.clear();pending.clear();depthAtlas?.dispose();group.clear()}
 return {update,dispose,manifest,group};
}
