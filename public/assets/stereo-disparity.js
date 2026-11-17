// Browser stereo matching for rectified SBS/TB pairs.
// Signed horizontal disparity is estimated with a small SAD window; confidence
// rejects textureless / ambiguous matches rather than inventing depth.
export function stereoDisparity(leftCanvas,rightCanvas,{width=256,maxShift=28}={}){
  const w=Math.min(width,leftCanvas.width),h=Math.max(48,Math.round(w*leftCanvas.height/leftCanvas.width));
  const gray=(canvas)=>{
    const c=document.createElement('canvas');c.width=w;c.height=h;
    const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(canvas,0,0,w,h);
    const p=ctx.getImageData(0,0,w,h).data,g=new Float32Array(w*h);
    for(let i=0;i<g.length;i++)g[i]=.299*p[i*4]+.587*p[i*4+1]+.114*p[i*4+2];
    return g;
  };
  const a=gray(leftCanvas),b=gray(rightCanvas);
  const disparity=new Float32Array(w*h),confidence=new Float32Array(w*h);
  const radius=2,limit=Math.min(maxShift,Math.floor(w*.14));
  for(let y=radius+2;y<h-radius-2;y+=2){
    for(let x=limit+radius+1;x<w-limit-radius-1;x+=2){
      let texture=0;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++){
        texture+=Math.abs(a[(y+dy)*w+x+dx]-a[(y+dy)*w+x+dx+1]);
      }
      if(texture<90)continue;
      let best=Infinity,second=Infinity,bestShift=0;
      for(let d=-limit;d<=limit;d++){
        let sad=0;
        for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
          sad+=Math.abs(a[(y+dy)*w+x+dx]-b[(y+dy)*w+x+dx-d]);
        }
        if(sad<best){second=best;best=sad;bestShift=d}
        else if(sad<second)second=sad;
      }
      // The runner-up must not be the immediate neighbor of the best match:
      // one-pixel offsets are normally almost equally good.
      second=Infinity;
      for(let d=-limit;d<=limit;d++){
        if(Math.abs(d-bestShift)<=2)continue;
        let sad=0;
        for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++)
          sad+=Math.abs(a[(y+dy)*w+x+dx]-b[(y+dy)*w+x+dx-d]);
        if(sad<second)second=sad;
      }
      const distinct=Number.isFinite(second)?Math.max(0,(second-best)/(second+1)):0;
      const quality=Math.max(0,1-best/700);
      const conf=Math.min(1,distinct*6)*quality;
      if(conf<.12)continue;
      const i=y*w+x;disparity[i]=bestShift;confidence[i]=conf;
    }
  }
  // Sparse, confidence-weighted spatial fill without extrapolating across the
  // entire image; retain zero confidence for unsupported sky/cloud areas.
  const filled=new Float32Array(w*h),weights=new Float32Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let sum=0,total=0;
    for(let dy=-4;dy<=4;dy+=2)for(let dx=-4;dx<=4;dx+=2){
      const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=w||yy>=h)continue;
      const i=yy*w+xx,c=confidence[i];if(!c)continue;
      const weight=c/(1+.18*(dx*dx+dy*dy));
      sum+=disparity[i]*weight;total+=weight;
    }
    const i=y*w+x;
    if(total>.03){filled[i]=sum/total;weights[i]=Math.min(1,total*2)}
  }
  const values=[];
  for(let i=0;i<filled.length;i++)if(weights[i]>.18)values.push(filled[i]);
  values.sort((a,b)=>a-b);
  const lo=values[Math.floor(values.length*.05)]??0;
  const hi=values[Math.floor(values.length*.95)]??1;
  const range=Math.max(1,hi-lo);
  const depth=new Float32Array(w*h);
  for(let i=0;i<depth.length;i++)depth[i]=Math.max(0,Math.min(1,(filled[i]-lo)/range));
  return {width:w,height:h,depth,confidence:weights,validFraction:values.length/(w*h)};
}
export function drawDepthPreview(depth,w,h){
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d');const img=ctx.createImageData(w,h);
  for(let i=0;i<w*h;i++){const v=Math.round(Math.max(0,Math.min(1,depth[i]))*255),k=i*4;img.data[k]=v;img.data[k+1]=v;img.data[k+2]=v;img.data[k+3]=255}
  ctx.putImageData(img,0,0);return canvas;
}
