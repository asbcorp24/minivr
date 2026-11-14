// Optional desktop-only positional camera control. No VR or Cardboard hooks.
export function createDesktop3DWindow(canvas){
 const key='minivr:desktop-3d-window:v1';
 let enabled=false,dragging=false,lastX=0,lastY=0;
 let x=0,y=0,desiredX=0,desiredY=0;
 try{enabled=localStorage.getItem(key)==='1'}catch{}
 const panel=document.createElement('label');
 panel.title='Объёмный 3D: отдельная геометрия глубины и более чёткие края объектов; Shift + мышь — смещение';
 panel.style.cssText='position:fixed;right:12px;bottom:60px;z-index:10002;background:#071824;color:#fff;border:1px solid #43849d;border-radius:8px;padding:8px 10px;font:13px sans-serif;display:flex;align-items:center;gap:7px;cursor:pointer';
 const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=enabled;
 const label=document.createElement('span');label.textContent='Объёмный 3D (рельеф)';
 panel.append(checkbox,label);document.body.appendChild(panel);
 checkbox.addEventListener('change',()=>{enabled=checkbox.checked;if(!enabled){dragging=false;desiredX=desiredY=0;}try{localStorage.setItem(key,enabled?'1':'0')}catch{}window.location.reload();});
 const isEligible=()=>enabled&&document.pointerLockElement!==canvas;
 canvas.addEventListener('pointerdown',e=>{
  if(!isEligible()||!e.shiftKey||e.button!==0)return;
  dragging=true;lastX=e.clientX;lastY=e.clientY;
 });
 window.addEventListener('pointermove',e=>{
  if(!dragging)return;
  if(!(e.buttons&1)){dragging=false;return;}
  const dx=e.clientX-lastX,dy=e.clientY-lastY;lastX=e.clientX;lastY=e.clientY;
  desiredX=Math.max(-1,Math.min(1,desiredX+dx/240));
  desiredY=Math.max(-1,Math.min(1,desiredY-dy/240));
 });
 window.addEventListener('pointerup',()=>{dragging=false});
 window.addEventListener('blur',()=>{dragging=false});
 window.addEventListener('keydown',e=>{
  if(e.key.toLowerCase()!=='r'||e.altKey||e.ctrlKey||e.metaKey)return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||'')||document.activeElement?.isContentEditable)return;
  desiredX=desiredY=0;
 });
 return {
  isDragging:()=>dragging,
  isEnabled:()=>enabled,
  update(dt,active){
   if(!active||!enabled){dragging=false;desiredX=desiredY=0;}
   const damping=1-Math.exp(-Math.max(0,dt)*7);
   x+=(desiredX-x)*damping;y+=(desiredY-y)*damping;
   // Existing depth geometry uses radius ~12-46; keep translation conservative.
   return {x:x*1.25,y:y*.75};
  }
 };
}
