import assert from 'node:assert/strict';
import {makeFoliageWindMask} from '../public/assets/foliage-wind-mask.js';

const oldDocument=globalThis.document;
const masks=[];
globalThis.document={createElement(type){
 assert.equal(type,'canvas');
 const canvas={width:0,height:0};
 canvas.getContext=()=>({
  createImageData:(width,height)=>({data:new Uint8ClampedArray(width*height*4)}),
  putImageData:frame=>{canvas.data=frame.data;}
 });
 masks.push(canvas);
 return canvas;
}};
class CanvasTexture{constructor(image){this.image=image;}}
const THREE={CanvasTexture,RepeatWrapping:'repeat',LinearFilter:'linear'};
const pixels=(w,h,colour)=>{
 const result=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const color=colour(x,y),i=(y*w+x)*4;
  result.set([...color,255],i);
 }
 return result;
};
try{
 const w=64,h=64;
 const greenery=pixels(w,h,(x,y)=>((x+y)%4<2?[28,139,42]:[190,105,200]));
 const tiled=makeFoliageWindMask(THREE,greenery,w,h,{maxWidth:32,maxHeight:24});
 assert.equal(tiled.image.width,32);
 assert.equal(tiled.image.height,24);
 assert.equal(tiled.wrapS,'repeat');
 assert.equal(tiled.minFilter,'linear');
 assert.ok(tiled.image.data.some((value,i)=>i%4===0&&value>0),'Textured greenery produces a nonzero wind mask');
 const neutral=makeFoliageWindMask(THREE,pixels(w,h,()=>[125,125,125]),w,h);
 assert.equal(neutral.image.width,64);
 assert.equal(neutral.image.height,64);
 assert.equal(neutral.image.data.some((value,i)=>i%4===0&&value>0),false,'Neutral sky/stone does not sway like vegetation');
 const bright=makeFoliageWindMask(THREE,pixels(w,h,()=>[255,255,240]),w,h);
 assert.equal(bright.image.data.some((value,i)=>i%4===0&&value>0),false,'Bright foam stays still');
 assert.equal(masks.length,3);
}finally{globalThis.document=oldDocument;}

console.log('foliage-wind-mask: legacy colour mask, tile resolution limit and neutral pixels passed');
