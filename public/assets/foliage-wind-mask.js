// Colour/texture mask shared by legacy panorama rendering and individual
// image tiles. Input pixels are top-to-bottom RGBA, as returned by Canvas.
// The mask is deliberately conservative: featureless sky and bright foam
// must not move like foliage.
export function makeFoliageWindMask(THREE,original,w,h,{maxWidth=512,maxHeight=256}={}){
 const mw=Math.min(maxWidth,w),mh=Math.min(maxHeight,h);
 const canvas=document.createElement('canvas');canvas.width=mw;canvas.height=mh;
 const ctx=canvas.getContext('2d'),frame=ctx.createImageData(mw,mh);
 const colour=(x,y)=>{
  x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));
  const i=(y*w+x)*4,r=original[i]/255,g=original[i+1]/255,b=original[i+2]/255;
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;
  if(hi<.12||hi>.96||d<.07)return 0;
  let hue=0;
  if(hi===r)hue=60*(((g-b)/d+6)%6);
  else if(hi===g)hue=60*((b-r)/d+2);
  else hue=60*((r-g)/d+4);
  const seasonal=(hue>=35&&hue<=165)?1:(hue>=12&&hue<35)?.75:(hue<12||hue>345)?.55:0;
  return seasonal*Math.min(1,d/hi*3);
 };
 for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
  const sx=Math.floor((x+.5)*w/mw),sy=Math.floor((y+.5)*h/mh);
  const step=Math.max(1,Math.floor(w/mw/2));
  let sum=0,min=1,max=0;
  for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){
   const v=colour(sx+xx*step,sy+yy*step);sum+=v;min=Math.min(min,v);max=Math.max(max,v);
  }
  const weight=Math.min(1,sum/25)*Math.min(1,(max-min)*5);
  const i=(y*mw+x)*4;
  frame.data[i]=frame.data[i+1]=frame.data[i+2]=Math.round(weight*255);
  frame.data[i+3]=255;
 }
 ctx.putImageData(frame,0,0);
 const texture=new THREE.CanvasTexture(canvas);
 texture.wrapS=THREE.RepeatWrapping;texture.minFilter=THREE.LinearFilter;
 return texture;
}
