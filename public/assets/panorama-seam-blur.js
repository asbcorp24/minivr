// Viewer-only correction of a mismatched 0°/360° image boundary. The original
// upload stays untouched, and zero strength costs no GPU or canvas work.
export function seamBlurAmount(value) {
 const n=Number(value);
 return Number.isFinite(n)?Math.max(0,Math.min(100,n)):0;
}

// Width on EACH side of the seam, as a fraction of the full 360° image.
export function seamBlurFraction(value) {
 return seamBlurAmount(value)/100*.015;
}

export function seamBlendWeight(distance,width) {
 if(width<=0||distance>=width)return 0;
 const t=Math.max(0,Math.min(1,distance/width));
 return 1-t*t*(3-2*t);
}

// The two tiles can have unequal widths at the end of a tiled image level.
// This operates only on the narrow seam strips, not the rest of the tiles.
export function blendSeamTilePixels(leftPixels,leftWidth,rightPixels,rightWidth,height,panoramaWidth,strength) {
 if(leftWidth<1||rightWidth<1||height<1||leftPixels.length!==leftWidth*height*4||rightPixels.length!==rightWidth*height*4)
  throw new Error('Invalid seam tile pixels');
 const requested=Math.round(panoramaWidth*seamBlurFraction(strength));
 const radius=Math.min(requested,Math.floor(Math.min(leftWidth,rightWidth)/3));
 if(radius<=0)return 0;
 const leftSource=new Uint8ClampedArray(leftPixels);
 const rightSource=leftPixels===rightPixels?leftSource:new Uint8ClampedArray(rightPixels);
 for(let y=0;y<height;y++){
  const first=(y*leftWidth)*4,last=(y*rightWidth+rightWidth-1)*4;
  for(let channel=0;channel<4;channel++){
   const middle=(leftSource[first+channel]+rightSource[last+channel])/2;
   for(let k=0;k<radius;k++){
    const weight=seamBlendWeight(k,radius);
    const a=first+k*4+channel,b=last-k*4+channel;
    leftPixels[a]=Math.round(leftSource[a]*(1-weight)+middle*weight);
    rightPixels[b]=Math.round(rightSource[b]*(1-weight)+middle*weight);
   }
  }
 }
 return radius;
}

// Apply the same correction in a small shader region for non-tiled panoramas.
// This avoids copying an entire 8K/16K original into a large canvas.
export function installPanoramaSeamShader(material,strength,bounds,texelWidth=0) {
 const width=seamBlurFraction(strength)*(bounds.y-bounds.x);
 if(width<=0)return;
 const previous=material.onBeforeCompile;
 material.onBeforeCompile=shader=>{
  previous?.(shader);
  shader.uniforms.minivrSeamBounds={value:bounds};
  shader.uniforms.minivrSeamWidth={value:width};
  shader.uniforms.minivrSeamTexel={value:texelWidth};
  shader.fragmentShader=`uniform vec2 minivrSeamBounds;
uniform float minivrSeamWidth;
uniform float minivrSeamTexel;
`+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('void main() {',`
vec4 minivrSeamSample(vec2 uv) {
 vec4 original=texture2D(map,uv);
 float gap=min(uv.x-minivrSeamBounds.x,minivrSeamBounds.y-uv.x);
 if(gap>=minivrSeamWidth)return original;
 float weight=1.0-smoothstep(0.0,minivrSeamWidth,max(0.0,gap));
 vec2 first=vec2(minivrSeamBounds.x+minivrSeamTexel,uv.y);
 vec2 last=vec2(minivrSeamBounds.y-minivrSeamTexel,uv.y);
 vec4 joined=(texture2D(map,first)+texture2D(map,last))*.5;
 return mix(original,joined,weight);
}
void main() {`);
  const samples=[
   ['vec4 sampledDiffuseColor = texture2D(map,windUv);','vec4 sampledDiffuseColor = minivrSeamSample(windUv);'],
   ['vec4 sampledDiffuseColor = texture2D(map,clamp(windUv,vec2(0.0),vec2(1.0)));','vec4 sampledDiffuseColor = minivrSeamSample(clamp(windUv,vec2(0.0),vec2(1.0)));'],
   ['diffuseColor*=texture2D(map,waterUv);','diffuseColor*=minivrSeamSample(waterUv);']
  ];
  let matched=false;
  for(const [before,after] of samples)if(shader.fragmentShader.includes(before)){
   shader.fragmentShader=shader.fragmentShader.replace(before,after);matched=true;break;
  }
  if(!matched)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
   '#ifdef USE_MAP\n diffuseColor *= minivrSeamSample(vMapUv);\n#endif');
 };
 const previousKey=material.customProgramCacheKey;
 material.customProgramCacheKey=()=>`${previousKey?.call(material)||'minivr'}-seam-blur-v1`;
}
