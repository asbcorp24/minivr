// Screen-space visibility test for the equirectangular sphere seam.
// Points are projected seam samples in CSS-pixel coordinates.
export function seamViewportPenetration(points,width,height){
 const w=Math.max(1,Number(width)||1),h=Math.max(1,Number(height)||1);
 let depth=0,visibleSamples=0;
 for(const point of points||[]){
  const x=Number(point.x),y=Number(point.y);
  if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>w||y<0||y>h)continue;
  visibleSamples++;
  depth=Math.max(depth,Math.min(x,w-x,y,h-y));
 }
 return {depth,visibleSamples};
}
