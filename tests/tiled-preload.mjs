import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/assets/tiled-panorama.js',import.meta.url),'utf8')
 .replace(/^import .*;\s*/,'').replace('export async function createTiledPanorama','async function createTiledPanorama');
const loaded=[],revoked=[],calls=[];
class BufferGeometry{
 setAttribute(){}setIndex(){}dispose(){}
}
class Group{
 constructor(){this.children=[];this.visible=true;}
 add(value){this.children.push(value)}
 remove(value){this.children=this.children.filter(item=>item!==value)}
 clear(){this.children=[]}
}
class MeshBasicMaterial{constructor(options){Object.assign(this,options);}dispose(){}}
class Mesh{constructor(geometry,material){this.geometry=geometry;this.material=material;this.frustumCulled=true;}}
class TextureLoader{
 load(url,onLoad){
  loaded.push(url);
  onLoad({colorSpace:null,dispose(){}});
 }
}
class Vector3{constructor(){this.x=-1;this.y=0;this.z=0;}}
const THREE={Group,BufferGeometry,Float32BufferAttribute:class{},MeshBasicMaterial,Mesh,TextureLoader,Vector3,
 BackSide:1,SRGBColorSpace:2,MathUtils:{degToRad:value=>value*Math.PI/180,clamp:(v,min,max)=>Math.max(min,Math.min(max,v))}};
const context={THREE,performance:{now:()=>1000},
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

console.log('tiled-preload: cached base tiles and ordinary tile fallback passed');
