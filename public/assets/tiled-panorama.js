import * as THREE from '/assets/vendor/three/three.module.js';
/* Independent tiled panorama layer. Never modifies Cardboard renderer or eye cameras. */
export async function createTiledPanorama({url,scene,camera,renderer,mirror=false}){
 const response=await fetch(url,{credentials:'same-origin'});if(!response.ok)throw Error('Tiles manifest HTTP '+response.status);
 const manifest=await response.json();if(manifest.projection!=='360'||!Array.isArray(manifest.levels)||!manifest.levels.length)throw Error('Invalid tile manifest');
 const base=url.slice(0,url.lastIndexOf('/')+1),group=new THREE.Group();scene.add(group);
 const loader=new THREE.TextureLoader(),tiles=new Map(),pending=new Set(),maxConcurrent=5;
 const geometry=(level,x,y)=>{
  const cols=level.cols,rows=level.rows,sw=level.width,sh=level.height,ts=manifest.tileSize;
  const u0=x*ts/sw,u1=Math.min((x+1)*ts/sw,1),v0=y*ts/sh,v1=Math.min((y+1)*ts/sh,1);
  const segments=12,g=new THREE.BufferGeometry(),positions=[],uvs=[],indices=[];
  for(let j=0;j<=segments;j++)for(let i=0;i<=segments;i++){
   const u=u0+(u1-u0)*i/segments,v=v0+(v1-v0)*j/segments;
   const theta=(mirror?1-u:u)*Math.PI*2,phi=v*Math.PI;
   positions.push(-500*Math.cos(theta)*Math.sin(phi),500*Math.cos(phi),500*Math.sin(theta)*Math.sin(phi));
   uvs.push(i/segments,1-j/segments);
  }
  for(let j=0;j<segments;j++)for(let i=0;i<segments;i++){const k=j*(segments+1)+i;indices.push(k,k+segments+1,k+1,k+1,k+segments+1,k+segments+2)}
  g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));g.setIndex(indices);return g;
 };
 function load(level,x,y){
  const key=level.level+':'+x+':'+y;if(tiles.has(key)||pending.has(key)||pending.size>=maxConcurrent)return;
  pending.add(key);
  loader.load(base+level.level+'/'+x+'_'+y+'.jpg',texture=>{
   pending.delete(key);texture.colorSpace=THREE.SRGBColorSpace;
   const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,depthWrite:false});
   const mesh=new THREE.Mesh(geometry(level,x,y),material);mesh.renderOrder=level.level;
   mesh.frustumCulled=false;group.add(mesh);tiles.set(key,{mesh,level:level.level,last:performance.now()});
  },undefined,()=>pending.delete(key));
 }
 const low=manifest.levels[0];
 const baseQueue=[];for(let y=0;y<low.rows;y++)for(let x=0;x<low.cols;x++)baseQueue.push([x,y]);
 let last=0;
 function update(){
  if(performance.now()-last<160)return;last=performance.now();
  for(const [bx,by] of baseQueue)load(low,bx,by);
 const fov=camera.fov||75;
  const idx=Math.max(0,Math.min(manifest.levels.length-1,Math.floor(Math.log2(75/Math.max(10,fov)))+1));
  const level=manifest.levels[idx];camera.updateMatrixWorld(true);
  const direction=new THREE.Vector3();camera.getWorldDirection(direction);
  const angle=Math.atan2(direction.z,-direction.x),u0=((angle/(Math.PI*2))%1+1)%1,u=mirror?1-u0:u0;
  const v=Math.acos(THREE.MathUtils.clamp(direction.y,-1,1))/Math.PI;
  const x=Math.floor(u*level.width/manifest.tileSize),y=Math.floor(v*level.height/manifest.tileSize);
  for(let dy=-1;dy<=1;dy++)for(let dx=-2;dx<=2;dx++){
   const xx=((x+dx)%level.cols+level.cols)%level.cols,yy=y+dy;
   if(yy>=0&&yy<level.rows)load(level,xx,yy);
  }
  // Keep base layer permanently; remove distant high-resolution tiles to cap GPU memory.
  const now=performance.now();for(const [key,item] of tiles){
   if(item.level===0)continue;
   if(item.level!==level.level||now-item.last>20000){
    group.remove(item.mesh);item.mesh.geometry.dispose();item.mesh.material.map.dispose();item.mesh.material.dispose();tiles.delete(key);
   }else item.last=now;
  }
 }
 function dispose(){scene.remove(group);for(const item of tiles.values()){item.mesh.geometry.dispose();item.mesh.material.map.dispose();item.mesh.material.dispose()}tiles.clear();group.clear()}
 return {update,dispose,manifest};
}
