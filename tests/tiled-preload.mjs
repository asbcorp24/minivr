import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {makeDepthRadiusField,sampleDepthRadius} from '../public/assets/depth-tile-geometry.js';

const source=readFileSync(new URL('../public/assets/tiled-panorama.js',import.meta.url),'utf8')
 .replace(/^import .*;\s*/gm,'').replace('export async function createTiledPanorama','async function createTiledPanorama');
const loaded=[],revoked=[],calls=[],disposed=[],generatedMasks=[];
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
class MeshBasicMaterial{constructor(options){Object.assign(this,options);}dispose(){disposed.push('material');}}
class Mesh{constructor(geometry,material){this.geometry=geometry;this.material=material;this.frustumCulled=true;}}
class TextureLoader{
 load(url,onLoad){
  loaded.push(url);
  onLoad({colorSpace:null,image:{width:512,height:512},dispose(){disposed.push('image texture');}});
 }
}
class DataTexture{constructor(pixels,width,height){this.image={data:pixels,width,height};}dispose(){disposed.push('depth atlas');}}
class CanvasTexture{constructor(canvas){this.image=canvas;}dispose(){disposed.push('wind mask');}}
class Vector4{constructor(x,y,z,w){Object.assign(this,{x,y,z,w});}}
class Vector3{constructor(){this.x=-1;this.y=0;this.z=0;}}
const THREE={Group,BufferGeometry,Float32BufferAttribute:class{constructor(array){this.array=array;}},MeshBasicMaterial,Mesh,TextureLoader,DataTexture,CanvasTexture,Vector3,Vector4,
 BackSide:1,SRGBColorSpace:2,RGBAFormat:3,UnsignedByteType:4,RepeatWrapping:5,LinearFilter:6,
 MathUtils:{degToRad:value=>value*Math.PI/180,clamp:(v,min,max)=>Math.max(min,Math.min(max,v))}};
const context={THREE,sampleDepthRadius,performance:{now:()=>1000},
 document:{createElement:()=>({width:0,height:0,getContext:()=>({drawImage(){},getImageData:()=>({data:new Uint8ClampedArray(256*256*4)})})})},
 makeFoliageWindMask:(_three,_pixels,_w,_h,limits)=>{generatedMasks.push(limits);return new CanvasTexture({type:'auto'});},
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

// Automatic wind uses one 96² foliage mask per JPEG tile. The phase is
// updated each animation frame, not on the throttled tile-load schedule.
const animated=await context.createTiledPanorama({url:'/tiles/wind/manifest.json',scene,camera,renderer:{},manifest,
 depth:{...depth,motion:{manualImage:null,strength:.6,speed:1.4,previewMask:false}}});
animated.update();
assert.equal(generatedMasks.length,2);
assert.deepEqual([...Object.values(generatedMasks[0])],[96,96]);
assert.match(animated.group.children[1].material.customProgramCacheKey(),/still/,'Distant depth layers remain stationary');
const moving=animated.group.children[2];
assert.match(moving.material.customProgramCacheKey(),/auto/);
const motionShader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
moving.material.onBeforeCompile(motionShader);
assert.match(motionShader.fragmentShader,/globalWindUv/,'Wind phase uses global longitude coordinates');
assert.match(motionShader.fragmentShader,/localShift/,'Global motion is scaled to the local tile UV');
assert.match(motionShader.fragmentShader,/smoothstep\(0.0, 0.02, edge\)/,'Displacements fade out at tile seams');
animated.setMotionTime(1400);
assert.ok(Math.abs(motionShader.uniforms.microMotionTime.value-1.96)<1e-9);
const beforeAutoDispose=disposed.filter(item=>item==='wind mask').length;
animated.dispose();
assert.equal(disposed.filter(item=>item==='wind mask').length-beforeAutoDispose,2,'Auto masks disposed once per tile');

// A hand-painted 512×256 mask is shared by all depth bands and all tiles,
// so the custom foliage regions remain identical across tile boundaries.
const beforeManual=generatedMasks.length;
const manual=await context.createTiledPanorama({url:'/tiles/manual/manifest.json',scene,camera,renderer:{},manifest,
 depth:{...depth,motion:{manualImage:{width:512,height:256},strength:1,speed:1,previewMask:true}}});
manual.update();
assert.equal(generatedMasks.length,beforeManual,'Manual mask bypasses auto detection');
const manualShader={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
manual.group.children[1].material.onBeforeCompile(manualShader);
assert.match(manualShader.fragmentShader,/globalWindUv\)\.a/,'Manual mask alpha is sampled in global UV');
assert.match(manualShader.fragmentShader,/vec3\(1.0,0.1,0.75\)/,'Mask preview remains available');
const manualShader2={uniforms:{},vertexShader:'void main() {\n#include <uv_vertex>',fragmentShader:'void main() {\n#include <map_fragment>'};
manual.group.children[5].material.onBeforeCompile(manualShader2);
assert.equal(manualShader.uniforms.foliageWindMask.value,manualShader2.uniforms.foliageWindMask.value,'All tiles use one manual mask texture');
const beforeManualDispose=disposed.filter(item=>item==='wind mask').length;
manual.dispose();
assert.equal(disposed.filter(item=>item==='wind mask').length-beforeManualDispose,1,'One shared manual mask is disposed');

console.log('tiled-preload: cached tiles, depth seams, foliage animation and resource disposal passed');
