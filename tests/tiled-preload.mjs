import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeDepthRadiusField,sampleDepthRadius} from '../public/assets/depth-tile-geometry.js';
import {makeTileFoliageMask} from '../public/assets/tile-foliage-mask.js';
import {seamBlurAmount,blendSeamTilePixels} from '../public/assets/panorama-seam-blur.js';

const source=readFileSync(new URL('../public/assets/tiled-panorama.js',import.meta.url),'utf8')
 .replace(/^import .*;\s*/gm,'').replace('export async function createTiledPanorama','async function createTiledPanorama');
const loaded=[],revoked=[],calls=[],disposed=[];
class BufferGeometry{
 constructor(){this.attributes={};}
 setAttribute(name,attribute){this.attributes[name]=attribute;}
 setIndex(indices){this.indices=indices;}
 dispose(){disposed.push('geometry');}
}
class Group{
 constructor(){this.children=[];this.visible=true;}
 add(value){this.children.push(value)}
 remove(value){this.children=this.children.filter(item=>item!==value)}
 clear(){this.children=[]}
}
class MeshBasicMaterial{
 constructor(options){Object.assign(this,options);}
 customProgramCacheKey(){return this.onBeforeCompile.toString();}
 dispose(){disposed.push('material');}
}
class Mesh{constructor(geometry,material){this.geometry=geometry;this.material=material;this.frustumCulled=true;}}
class TextureLoader{
 load(url,onLoad){
  loaded.push(url);
  const pixels=new Uint8ClampedArray(32*32*4);
  for(let i=0;i<32*32;i++){
   const x=i%32,green=x<16;
   pixels[i*4]=green?40:140;
   pixels[i*4+1]=green?(i%2?200:120):140;
   pixels[i*4+2]=green?35:140;
   pixels[i*4+3]=255;
  }
  onLoad({colorSpace:null,image:{width:32,height:32,pixels},dispose(){disposed.push('image texture');}});
 }
}
class DataTexture{constructor(pixels,width,height){this.image={data:pixels,width,height};}dispose(){disposed.push('depth atlas');}}
class CanvasTexture{constructor(canvas){this.image=canvas;}dispose(){disposed.push('foliage mask');}}
class Vector4{constructor(x,y,z,w){Object.assign(this,{x,y,z,w});}}
class Vector3{constructor(){this.x=-1;this.y=0;this.z=0;}}
const THREE={Group,BufferGeometry,Float32BufferAttribute:class{constructor(array){this.array=array;}},MeshBasicMaterial,Mesh,TextureLoader,DataTexture,CanvasTexture,Vector3,Vector4,
 BackSide:1,SRGBColorSpace:2,RGBAFormat:3,UnsignedByteType:4,RepeatWrapping:5,LinearFilter:6,
 MathUtils:{degToRad:value=>value*Math.PI/180,clamp:(v,min,max)=>Math.max(min,Math.min(max,v))}};
const document={createElement(tag){
 assert.equal(tag,'canvas');
 const canvas={width:0,height:0};
 canvas.getContext=()=>({
  drawImage(image){canvas.sourcePixels=image.pixels||null},
  getImageData(){return {data:new Uint8ClampedArray(canvas.sourcePixels||canvas.width*canvas.height*4)}},
  putImageData(image){canvas.maskPixels=image.data}
 });
 return canvas;
}};
const context={THREE,sampleDepthRadius,makeTileFoliageMask,seamBlurAmount,blendSeamTilePixels,document,performance:{now:()=>1000},
 fetch:async url=>{calls.push(url);return {ok:true,json:async()=>manifest}},
 URL:{createObjectURL:()=> 'blob:cached-tile',revokeObjectURL:url=>revoked.push(url)}
};
vm.createContext(context);
vm.runInContext(`${source}\nthis.createTiledPanorama=createTiledPanorama;`,context);
const manifest={projection:'360',tileSize:512,levels:[{level:0,width:1024,height:512,cols:2,rows:1}]};
const scene=new Group();
const camera={fov:75,aspect:1.6,updateMatrixWorld(){},getWorldDirection(){}};
const baseTiles=new Map([['0/0_0.jpg',{size:3}],['0/1_0.jpg',{size:3}]]);

const panorama=await context.createTiledPanorama({url:'/tiles/test/manifest.json',scene,camera,renderer:{},manifest,baseTiles});
assert.equal(calls.length,0,'Cached manifest avoids network request');
panorama.update();
assert.equal(loaded.length,2);
assert.equal(loaded.every(url=>url==='blob:cached-tile'),true,'Base tiles use cached blob URLs');
assert.equal(revoked.length,2,'Blob URLs are released after decode');
assert.equal(panorama.group.children.length,2);
panorama.dispose();
assert.equal(scene.children.length,0);

const blurred=await context.createTiledPanorama({url:'/tiles/seam/manifest.json',scene,camera,renderer:{},manifest,seamBlur:80});
blurred.update();
const seamLeft=blurred.group.children[0].material.map.image;
const seamRight=blurred.group.children[1].material.map.image;
assert.ok(seamLeft.maskPixels&&seamRight.maskPixels,'Edge tiles are blended after the opposite tile arrives');
for(let y=0;y<32;y++)for(let channel=0;channel<4;channel++){
 assert.equal(seamLeft.maskPixels[(y*32)*4+channel],seamRight.maskPixels[(y*32+31)*4+channel],
  '0° and 360° samples of a tile level must have identical edge colors');
}
assert.ok(blurred.group.children[0].material.map.needsUpdate,'GPU texture is refreshed after seamless correction');
blurred.dispose();
const singleManifest={projection:'360',tileSize:512,levels:[{level:0,width:512,height:512,cols:1,rows:1}]};
const single=await context.createTiledPanorama({url:'/tiles/single/manifest.json',scene,camera,renderer:{},manifest:singleManifest,seamBlur:100});
single.update();
assert.ok(single.group.children[0].material.map.image.maskPixels,'A panorama with one tile still wraps the seam');
single.dispose();

loaded.length=0;
const normal=await context.createTiledPanorama({url:'/tiles/test/manifest.json',scene,camera,renderer:{}});
assert.equal(calls.length,1,'Without cache the original manifest fetch is preserved');
normal.update();
assert.equal(loaded.some(url=>url==='/tiles/test/0/0_0.jpg'),true);
normal.dispose();

// Shared panorama image tiles become continuous spherical depth shells with
// GPU-composited depth bands. The original image texture is owned per tile,
// and the shared depth atlas is released exactly once upon dispose.
const depthPixels=new Uint8ClampedArray(256*128*4);
for(let y=0;y<128;y++)for(let x=0;x<256;x++)depthPixels[(y*256+x)*4]=x<128?30:220;
const field=makeDepthRadiusField(depthPixels,{parallaxStrength:80},true);
const depth={pixels:depthPixels,field,bands:3,occlusion:.55,nonlinear:0,relief:true};
const tiledDepth=await context.createTiledPanorama({url:'/tiles/depth/manifest.json',scene,camera,renderer:{},manifest,depth});
tiledDepth.update();
assert.equal(tiledDepth.group.children.length,8,'Every source tile has one backdrop and three depth bands');
const [backdrop,nearBand]=tiledDepth.group.children;
const position=nearBand.geometry.attributes.position.array;
assert.notEqual(Math.hypot(position[0],position[1],position[2]),500,'Depth tiling uses a displaced sphere');
assert.equal(backdrop.material.transparent,true,'LOD backdrops composite in the same transparent pass as depth bands');
assert.equal(nearBand.material.map,backdrop.material.map,'All bands reuse the same image texture');
const shader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
nearBand.material.onBeforeCompile(shader);
assert.match(shader.vertexShader,/depthUvTransform/);
assert.match(shader.fragmentShader,/texture2D\(depthAtlas/);
assert.equal(shader.uniforms.depthAtlas.value.image.width,256);
const tile0Band=tiledDepth.group.children[1],tile1Band=tiledDepth.group.children[5];
const first=tile0Band.geometry.attributes.position.array,second=tile1Band.geometry.attributes.position.array;
const verticesPerRow=37;
for(let row=0;row<37;row++)for(let axis=0;axis<3;axis++){
 const edge0=first[(row*verticesPerRow+36)*3+axis],edge1=second[(row*verticesPerRow)*3+axis];
 assert.ok(Math.abs(edge0-edge1)<1e-5,`Adjacent depth tiles have no crack at row ${row}, axis ${axis}`);
}
for(let row=0;row<37;row++)for(let axis=0;axis<3;axis++){
 const left=first[(row*verticesPerRow)*3+axis],right=second[(row*verticesPerRow+36)*3+axis];
 assert.ok(Math.abs(left-right)<1e-5,`Longitude 0°/360° meets at row ${row}, axis ${axis}`);
}
const texturesBefore=disposed.filter(value=>value==='image texture').length;
tiledDepth.dispose();
assert.equal(disposed.filter(value=>value==='image texture').length-texturesBefore,2,'Each image texture disposed once, not once per layer');
assert.equal(disposed.filter(value=>value==='depth atlas').length,1);

const mirrored=await context.createTiledPanorama({url:'/tiles/mirror/manifest.json',scene,camera,renderer:{},manifest,depth,mirror:true});
mirrored.update();
const seam0=mirrored.group.children[1].geometry.attributes.position.array;
const seam1=mirrored.group.children[5].geometry.attributes.position.array;
for(let row=0;row<37;row++)for(let axis=0;axis<3;axis++){
 const left=seam0[(row*verticesPerRow)*3+axis],right=seam1[(row*verticesPerRow+36)*3+axis];
 assert.ok(Math.abs(left-right)<1e-5,`Mirrored longitude wraps without a gap at row ${row}`);
}
mirrored.dispose();

// Manual masks are authored in global panorama UV, shared by all tile LODs
// and depth bands. The shader must sample alpha rather than RGB.
const manualMask={width:512,height:256};
const manual=await context.createTiledPanorama({url:'/tiles/manual/manifest.json',scene,camera,renderer:{},manifest,depth,
 foliage:{enabled:true,manualMask,strength:55,speed:2}});
manual.update(1000);
assert.equal(manual.group.children.length,8);
const manualShader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
manual.group.children[1].material.onBeforeCompile(manualShader);
assert.match(manualShader.fragmentShader,/texture2D\(foliageWindMask,vec2\(panoramaUv.x,1.0-panoramaUv.y\)\)\.a/);
assert.match(manualShader.fragmentShader,/tileEdge = smoothstep\(0\.0,0\.025,edgeDistance\)/,'Tile borders and the 360° seam cannot tear');
assert.match(manualShader.fragmentShader,/depthValue = texture2D\(depthAtlas/,'Hybrid depth mask remains intact');
assert.equal(manualShader.uniforms.foliageTileUv.value.x,0);
const neighborShader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
manual.group.children[5].material.onBeforeCompile(neighborShader);
assert.equal(neighborShader.uniforms.foliageTileUv.value.x,.5,'Each tile samples its actual global longitude');
assert.equal(manualShader.uniforms.foliageWindMask.value,neighborShader.uniforms.foliageWindMask.value,'Manual mask reused across tiles');
manual.update(1240);
assert.equal(manualShader.uniforms.microMotionTime.value,2.48,'Wind clock updates even within the LOD throttling interval');
const masksBeforeManual=disposed.filter(item=>item==='foliage mask').length;
manual.dispose();
assert.equal(disposed.filter(item=>item==='foliage mask').length-masksBeforeManual,1,'One shared manual GPU mask disposed once');

// Automatic candidate masks are built from each small decoded tile; farther
// depth bands remain still and every GPU mask belongs to exactly one tile.
const automatic=await context.createTiledPanorama({url:'/tiles/automatic/manifest.json',scene,camera,renderer:{},manifest,depth,
 foliage:{enabled:true,strength:80,speed:1}});
automatic.update();
assert.equal(automatic.group.children[1].material.onBeforeCompile.toString().includes('previous?.'),false,'Far depth band has no wind shader');
const autoShader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
automatic.group.children[3].material.onBeforeCompile(autoShader);
assert.match(automatic.group.children[3].material.customProgramCacheKey(),/foliage-v1-auto/,'Wind shader compiles with Three.js material program caching');
assert.match(autoShader.fragmentShader,/texture2D\(foliageWindMask,windUv\)\.r/);
assert.match(autoShader.fragmentShader,/microMotionBandWeight/);
const middleShader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
automatic.group.children[2].material.onBeforeCompile(middleShader);
assert.ok(middleShader.uniforms.microMotionBandWeight.value<autoShader.uniforms.microMotionBandWeight.value,'Foreground bands have independent wind strengths');
assert.equal(autoShader.uniforms.foliageWindMask.value.image.width,32,'Automatic mask is tile-sized, not panorama-sized');
const nextAutoShader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
automatic.group.children[7].material.onBeforeCompile(nextAutoShader);
assert.notEqual(autoShader.uniforms.foliageWindMask.value,nextAutoShader.uniforms.foliageWindMask.value,'Every tile owns its own mask');
assert.ok(autoShader.uniforms.foliageWindMask.value.image.maskPixels[0]>=0);
const masksBeforeAuto=disposed.filter(item=>item==='foliage mask').length;
const oldGroup=automatic.group;
const replacement=await context.createTiledPanorama({url:'/tiles/replacement/manifest.json',scene,camera,renderer:{},manifest,depth,
 foliage:{enabled:true,manualMask,strength:55}});
replacement.update();
automatic.dispose();
assert.equal(disposed.filter(item=>item==='foliage mask').length-masksBeforeAuto,2,'Two automatic GPU masks disposed on scene switch');
assert.ok(scene.children.includes(replacement.group)&&!scene.children.includes(oldGroup),'New scene remains active after old scene disposal');
const masksBeforeReplacement=disposed.filter(item=>item==='foliage mask').length;
replacement.dispose();
assert.equal(disposed.filter(item=>item==='foliage mask').length-masksBeforeReplacement,1,'Next scene mask independently disposed');

const plainWind=await context.createTiledPanorama({url:'/tiles/plain-wind/manifest.json',scene,camera,renderer:{},manifest,
 foliage:{enabled:true,strength:40}});
plainWind.update();
assert.equal(plainWind.group.children.length,2,'Wind also works with ordinary non-depth tiles');
const plainShader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
plainWind.group.children[0].material.onBeforeCompile(plainShader);
assert.match(plainShader.fragmentShader,/microMotionBandWeight/);
assert.equal(plainShader.uniforms.microMotionBandWeight.value,1);
plainWind.dispose();

console.log('tiled-preload: cache, depth, wind masks, longitude seam, scene transitions and GPU cleanup passed');
