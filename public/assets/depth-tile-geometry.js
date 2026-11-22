// Common 360° depth field for independently tessellated image tiles. It uses
// the same inverse-distance mapping and seam-aware smoothing as viewer.js.
// U wraps across the equirectangular seam; V is bottom-to-top texture UV.
export function sampleDepthPixels(pixels,u,v){
 if(!pixels||pixels.length!==256*128*4)return .5;
 const x=((u%1)+1)%1*256-.5,y=Math.max(0,Math.min(127,(1-v)*128-.5));
 const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 const read=(ix,iy)=>pixels[(Math.max(0,Math.min(127,iy))*256+((ix%256)+256)%256)*4]/255;
 const top=read(x0,y0)*(1-fx)+read(x0+1,y0)*fx;
 const bottom=read(x0,y0+1)*(1-fx)+read(x0+1,y0+1)*fx;
 return top*(1-fy)+bottom*fy;
}

export function makeDepthRadiusField(pixels,settings={},relief=false){
 if(!pixels||pixels.length!==256*128*4)throw new Error('Invalid panorama depth map');
 const width=relief?385:257,height=relief?193:129;
 const radii=new Float32Array(width*height);
 const strength=Math.max(0,Math.min(100,Number(settings.parallaxStrength)||0))/100;
 // The legacy spherical renderer keeps its original radius at zero strength.
 if(strength<=0){radii.fill(500);return {width,height,radii};}
 const nonlinear=settings.parallaxNonlinear===true
  ?Math.max(0,Math.min(100,Number(settings.parallaxNonlinearStrength??50)))/100:0;
 const near=relief?8:12,far=relief?58:46;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const u=x/(width-1),v=1-y/(height-1);
  let depth=sampleDepthPixels(pixels,u,v);
  const polarFade=Math.min(1,Math.max(0,Math.sin(Math.PI*v)*8));
  depth=.5+(depth-.5)*polarFade;
  if(nonlinear)depth=depth*(1-nonlinear)+Math.pow(depth,2.2)*nonlinear;
  const mapped=1/((1/far)+(1/near-1/far)*depth);
  const amount=relief?Math.min(1,strength*1.55):strength;
  radii[y*width+x]=26*(1-amount)+mapped*amount;
 }
 if(strength>0){
  const smooth=new Float32Array(radii);
  for(let y=1;y<height-1;y++)for(let x=0;x<width;x++){
   const i=y*width+x,left=y*width+(x===0?width-2:x-1),right=y*width+(x===width-1?1:x+1);
   if(relief){
    const center=radii[i],neighbors=[left,right,i-width,i+width];
    let total=center*4,weight=4;
    for(const n of neighbors){
     const difference=Math.abs(center-radii[n]);
     if(difference>1.6)continue;
     const w=Math.exp(-difference*difference/1.28);
     total+=radii[n]*w;weight+=w;
    }
    smooth[i]=total/weight;
   }else smooth[i]=radii[i]*.7+(radii[left]+radii[right]+radii[i-width]+radii[i+width])*.075;
  }
  radii.set(smooth);
 }
 // The same radial distance at both ends prevents a crack at longitude ±180°.
 for(let y=0;y<height;y++){
  const left=y*width,right=left+width-1,average=(radii[left]+radii[right])*.5;
  radii[left]=average;radii[right]=average;
 }
 return {width,height,radii};
}

export function sampleDepthRadius(field,u,v){
 const {width,height,radii}=field;
 const wrapped=((u%1)+1)%1,x=wrapped*(width-1),y=Math.max(0,Math.min(height-1,(1-v)*(height-1)));
 const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;
 const right=Math.min(width-1,ix+1),below=Math.min(height-1,iy+1);
 const top=radii[iy*width+ix]*(1-fx)+radii[iy*width+right]*fx;
 const bottom=radii[below*width+ix]*(1-fx)+radii[below*width+right]*fx;
 return top*(1-fy)+bottom*fy;
}

// These effects currently require a full-image render path. Preserve them
// exactly rather than silently suppressing wind/water or background filling.
export function canUseTiledDepth(settings={}){
 return settings.parallaxEnabled===true&&
  // Foliage motion is supported by the tiled renderer as of v2. Animated
  // water, contact shadows and experimental background fill still fall back.
  settings.parallaxWaterMotion!==true&&
  settings.parallaxContactShadows!==true&&settings.parallaxOcclusionFill===false;
}
