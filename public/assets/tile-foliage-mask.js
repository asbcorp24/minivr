// A cheap, local vegetation candidate mask for a decoded JPEG tile.
// Input is a small RGBA image, not the original full-resolution panorama.
// Manual masks take precedence; this heuristic is intentionally conservative.
export function makeTileFoliageMask(pixels,width,height){
 if(width<1||height<1||pixels.length!==width*height*4)throw new Error('Invalid foliage tile pixels');
 const candidates=new Float32Array(width*height),output=new Uint8ClampedArray(pixels.length);
 for(let i=0;i<candidates.length;i++){
  const offset=i*4,r=pixels[offset]/255,g=pixels[offset+1]/255,b=pixels[offset+2]/255;
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo;
  if(hi<.12||hi>.96||delta<.07)continue;
  let hue=0;
  if(hi===r)hue=60*(((g-b)/delta+6)%6);
  else if(hi===g)hue=60*((b-r)/delta+2);
  else hue=60*((r-g)/delta+4);
  const seasonal=(hue>=35&&hue<=165)?1:(hue>=12&&hue<35)?.75:(hue<12||hue>345)?.55:0;
  candidates[i]=seasonal*Math.min(1,delta/hi*3);
 }
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let sum=0,min=1,max=0;
  for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
   // Never wrap within a tile: its opposite edge is not its neighbour.
   const xx=Math.max(0,Math.min(width-1,x+dx)),yy=Math.max(0,Math.min(height-1,y+dy));
   const value=candidates[yy*width+xx];sum+=value;min=Math.min(min,value);max=Math.max(max,value);
  }
  const weight=Math.min(1,sum/25)*Math.min(1,(max-min)*5);
  const i=(y*width+x)*4;
  output[i]=output[i+1]=output[i+2]=Math.round(weight*255);
  output[i+3]=255;
 }
 return output;
}
