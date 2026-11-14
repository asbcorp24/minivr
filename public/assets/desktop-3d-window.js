// Desktop depth-relief toggle. Camera follows the existing pointer position,
// so no Shift key or mouse-button gesture is needed.
export function createDesktop3DWindow(){
 const key='minivr:desktop-3d-window:v2';
 let enabled=true;
 try{const stored=localStorage.getItem(key);if(stored!==null)enabled=stored==='1';}catch{}
 const panel=document.createElement('label');
 panel.title='Объёмный 3D: усиленный рельеф и движение точки обзора за курсором';
 panel.style.cssText='position:fixed;right:12px;bottom:60px;z-index:10002;background:#071824;color:#fff;border:1px solid #43849d;border-radius:8px;padding:8px 10px;font:13px sans-serif;display:flex;align-items:center;gap:7px;cursor:pointer';
 const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=enabled;
 const label=document.createElement('span');label.textContent='Объёмный 3D (рельеф)';
 panel.append(checkbox,label);document.body.appendChild(panel);
 checkbox.addEventListener('change',()=>{
  enabled=checkbox.checked;
  try{localStorage.setItem(key,enabled?'1':'0')}catch{}
  window.location.reload(); // Rebuild the depth mesh for the selected mode.
 });
 return {
  isDragging:()=>false,
  isEnabled:()=>enabled,
  update(dt,active,pointer){
   // The viewer already smooths pointer motion. Return a modest extra
   // translation only for desktop depth panoramas with this mode enabled.
   if(!active||!enabled||!pointer)return {x:0,y:0};
   return {x:pointer.x*.7,y:pointer.y*.42};
  }
 };
}
