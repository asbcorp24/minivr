(()=>{'use strict';
const root=document.getElementById('water-mask-editor');if(!root)return;
const field=document.querySelector('input[name="parallaxWaterMask"]'),photo=root.querySelector('[data-mask-photo]'),overlay=root.querySelector('canvas');
photo.src=root.dataset.image;const paint=document.createElement('canvas');paint.width=512;paint.height=256;
const ctx=paint.getContext('2d',{willReadFrequently:true}),view=overlay.getContext('2d');let tool='paint',brush=22,drawing=false,last=null,dirty=false;
function render(){view.clearRect(0,0,512,256);view.globalAlpha=.55;view.globalCompositeOperation='source-over';view.filter='sepia(1) saturate(8) hue-rotate(155deg)';view.drawImage(paint,0,0);view.globalAlpha=1;view.filter='none';}
function save(){if(!dirty)return;field.value=paint.toDataURL('image/png');dirty=false;}
function dot(x,y){ctx.save();ctx.globalCompositeOperation=tool==='erase'?'destination-out':'source-over';ctx.fillStyle='#fff';ctx.beginPath();ctx.arc(x,y,brush/2,0,Math.PI*2);ctx.fill();ctx.restore();}
function point(e){const rect=overlay.getBoundingClientRect();return{x:(e.clientX-rect.left)/rect.width*512,y:(e.clientY-rect.top)/rect.height*256};}
function stroke(e){const p=point(e);if(last){const d=Math.hypot(p.x-last.x,p.y-last.y),steps=Math.max(1,Math.ceil(d/(brush/4)));for(let i=1;i<=steps;i++)dot(last.x+(p.x-last.x)*i/steps,last.y+(p.y-last.y)*i/steps);}else dot(p.x,p.y);last=p;dirty=true;render();}
overlay.addEventListener('pointerdown',e=>{e.preventDefault();drawing=true;last=null;overlay.setPointerCapture(e.pointerId);stroke(e);});
overlay.addEventListener('pointermove',e=>{if(drawing)stroke(e);});
function stop(){if(drawing){drawing=false;last=null;save();}}overlay.addEventListener('pointerup',stop);overlay.addEventListener('pointercancel',stop);
root.querySelectorAll('[data-mask-tool]').forEach(btn=>btn.addEventListener('click',()=>{tool=btn.dataset.maskTool;root.querySelectorAll('[data-mask-tool]').forEach(b=>b.style.fontWeight=b===btn?'bold':'normal');}));
root.querySelector('[data-mask-brush]').addEventListener('input',e=>brush=Number(e.target.value));
root.querySelector('[data-mask-clear]').addEventListener('click',()=>{ctx.clearRect(0,0,512,256);dirty=true;render();save();});
if(field.value){const img=new Image();img.onload=()=>{ctx.drawImage(img,0,0,512,256);render();};img.src=field.value;}
root.closest('form')?.addEventListener('submit',save);
})();