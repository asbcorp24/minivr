import assert from 'node:assert/strict';
import {makeTileFoliageMask} from '../public/assets/tile-foliage-mask.js';

const width=32,height=16,pixels=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++){
 const index=(y*width+x)*4;
 if(x<width/2){
  const textured=(x+y)%2===0;
  pixels.set(textured?[32,185,35,255]:[110,125,110,255],index);
 }else pixels.set([135,135,135,255],index);
}
const mask=makeTileFoliageMask(pixels,width,height);
assert.equal(mask.length,pixels.length);
assert.ok(mask[(8*width+8)*4]>30,'Textured foliage creates a nonzero motion mask');
assert.equal(mask[(8*width+25)*4],0,'Featureless grey wall must not move');
assert.equal(mask[(8*width+25)*4+3],255,'Generated RGB weights have opaque alpha');
assert.equal(mask[(8*width+31)*4],0,'Opposite edges are not incorrectly wrapped as neighbours');
assert.throws(()=>makeTileFoliageMask(new Uint8ClampedArray(4),width,height),/Invalid/);
console.log('tile-foliage-mask: seasonal texture, local edges and invalid inputs passed');
