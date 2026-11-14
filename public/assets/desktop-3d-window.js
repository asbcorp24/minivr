// Desktop-only enhanced depth relief. Always on when a supported depth
// panorama is loaded; the viewer owns the desktop/VR eligibility check.
export function createDesktop3DWindow(){
 return {
  isDragging:()=>false,
  isEnabled:()=>true,
  update(dt,active,pointer){
   if(!active||!pointer)return {x:0,y:0};
   return {x:pointer.x*.7,y:pointer.y*.42};
  }
 };
}
