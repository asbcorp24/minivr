// Desktop depth-window camera response. The scene's depth geometry remains
// independent; this module only computes a bounded positional view offset.
export function createDesktop3DWindow(){
 let x=0,y=0,vx=0,vy=0;
 const spring=(value,velocity,target,dt)=>{
  const omega=10,step=Math.min(.05,Math.max(0,dt));
  const decay=Math.exp(-omega*step);
  const change=value-target;
  const next=(change+(velocity+omega*change)*step)*decay+target;
  const speed=(velocity-omega*(velocity+omega*change)*step)*decay;
  return [next,speed];
 };
 return {
  isDragging:()=>false,
  isEnabled:()=>true,
  reset(){x=0;y=0;vx=0;vy=0;},
  update(dt,active,pointer){
   const px=active&&pointer?Math.max(-1,Math.min(1,pointer.x)):0;
   const py=active&&pointer?Math.max(-1,Math.min(1,pointer.y)):0;
   // Eased at the edges, like peering through a window rather than panning.
   const tx=px*(1-.24*px*px)*.9;
   const ty=py*(1-.24*py*py)*.54;
   [x,vx]=spring(x,vx,tx,dt);
   [y,vy]=spring(y,vy,ty,dt);
   return {x,y};
  }
 };
}
