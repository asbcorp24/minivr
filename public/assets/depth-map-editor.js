// Manual corrections to the saved panorama depth map; no model download required.
const panel=document.querySelector('[data-depth-panel]');
if(panel){
 const root=panel.querySelector('[data-depth-editor]');
 const saved=panel.querySelector('[data-depth-saved]');
 const status=panel.querySelector('[data-depth-status]');
 const strength=panel.closest('form').querySelector('[name="parallaxStrength"]');
 if(root&&saved){
  const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
  const brush=root.querySelector('[data-brush]'),value=root.querySelector('[data-value]');
  const mode=root.querySelector('[data-mode]'),opacity=root.querySelector('[data-opacity]');
  const history=[],redo=[];let original=null,working=null,painting=false,last=null,dirty=false;
  const buttons={save:root.querySelector('[data-save]'),undo:root.querySelector('[data-undo]'),redo:root.querySelector('[data-redo]'),reset:root.querySelector('[data-reset]'),restore:root.querySelector('[data-restore]')};
  const W=512,H=256;canvas.width=W;canvas.height=H;
  function snapshot(){history.push(new Uint8ClampedArray(working.data));if(history.length>20)history.shift();redo.length=0;}
  function draw(){ctx.putImageData(working,0,0);buttons.undo.disabled=!history.length;buttons.redo.disabled=!redo.length;buttons.save.disabled=!dirty;}
  function setPixels(pixels){working.data.set(pixels);dirty=true;draw();}
  async function load(){
   const img=new Image();img.src=saved.src;await img.decode();
   ctx.drawImage(img,0,0,W,H);original=ctx.getImageData(0,0,W,H);
   working=ctx.createImageData(W,H);working.data.set(original.data);dirty=false;draw();
  }
  function paint(x,y){
   const r=Number(brush.value),v=Number(value.value)*255/100,a=Number(opacity.value)/100;
   const radius=Math.max(1,r),x0=Math.floor(x-radius),x1=Math.ceil(x+radius);
   for(let yy=Math.max(0,Math.floor(y-radius));yy<=Math.min(H-1,Math.ceil(y+radius));yy++){
    for(let xx=x0;xx<=x1;xx++){
     const dx=xx-x,dy=yy-y,d=Math.hypot(dx,dy);if(d>radius)continue;
     const px=((xx%W)+W)%W,idx=(yy*W+px)*4;
     const weight=a*Math.min(1,(radius-d)/Math.max(1,radius*.25));
     const old=working.data[idx];
     let target=v;
     if(mode.value==='erase')target=original.data[idx];
     if(mode.value==='smooth'){
      let sum=0,n=0;
      for(let sy=-2;sy<=2;sy++)for(let sx=-2;sx<=2;sx++){
       const py=Math.max(0,Math.min(H-1,yy+sy)),qx=(px+sx+W)%W;
       sum+=working.data[(py*W+qx)*4];n++;
      }target=sum/n;
     }
     const next=Math.round(old+(target-old)*weight);
     working.data[idx]=working.data[idx+1]=working.data[idx+2]=next;
     working.data[idx+3]=255;
    }
   }
   dirty=true;
  }
  function position(e){const rect=canvas.getBoundingClientRect();return {x:(e.clientX-rect.left)*W/rect.width,y:(e.clientY-rect.top)*H/rect.height};}
  canvas.addEventListener('pointerdown',e=>{if(!working)return;e.preventDefault();snapshot();painting=true;last=position(e);canvas.setPointerCapture(e.pointerId);paint(last.x,last.y);draw();});
  canvas.addEventListener('pointermove',e=>{if(!painting)return;e.preventDefault();const p=position(e),steps=Math.max(1,Math.ceil(Math.hypot(p.x-last.x,p.y-last.y)/Math.max(1,Number(brush.value)/3)));for(let i=1;i<=steps;i++){const t=i/steps;paint(last.x+(p.x-last.x)*t,last.y+(p.y-last.y)*t);}last=p;draw();});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])canvas.addEventListener(type,()=>{painting=false;last=null;});
  buttons.undo.addEventListener('click',()=>{if(!history.length)return;redo.push(new Uint8ClampedArray(working.data));setPixels(history.pop());});
  buttons.redo.addEventListener('click',()=>{if(!redo.length)return;history.push(new Uint8ClampedArray(working.data));setPixels(redo.pop());});
  buttons.reset.addEventListener('click',()=>{if(!original||!confirm('Отменить все локальные правки карты?'))return;snapshot();setPixels(original.data);});
  async function send(form){
   const response=await fetch('/admin/depth-upload.php',{method:'POST',body:form,credentials:'same-origin'});
   const data=await response.json();if(!response.ok||!data.ok)throw Error(data.error||'Ошибка сохранения');
   return data;
  }
  buttons.save.addEventListener('click',async()=>{
   if(!working)return;buttons.save.disabled=true;status.textContent='Сохраняю ручную карту глубины…';
   try{
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob)throw Error('Не удалось создать PNG');
    const form=new FormData();form.append('id',panel.dataset.id);form.append('strength',strength.value);form.append('manual','1');form.append('depth',blob,'manual-depth.png');
    const data=await send(form);saved.src=data.url+'?v='+Date.now();const download=panel.querySelector('[data-depth-download]');if(download)download.href=data.url;
    original=ctx.createImageData(W,H);original.data.set(working.data);dirty=false;history.length=0;redo.length=0;draw();
    status.textContent='Исправленная карта сохранена. Откройте панораму для просмотра результата.';
   }catch(e){status.textContent='Ошибка: '+e.message;buttons.save.disabled=false;}
  });
  buttons.restore.addEventListener('click',async()=>{
   if(!confirm('Вернуть исходную автоматически созданную карту глубины?'))return;
   const form=new FormData();form.append('id',panel.dataset.id);form.append('action','restore');
   try{const data=await send(form);saved.src=data.url+'?v='+Date.now();const download=panel.querySelector('[data-depth-download]');if(download)download.href=data.url;await load();history.length=0;redo.length=0;dirty=false;draw();status.textContent='Исходная карта восстановлена.';}
   catch(e){status.textContent='Ошибка: '+e.message;}
  });
  load().catch(e=>{status.textContent='Не удалось открыть карту глубины: '+e.message;root.hidden=true;});
 }
}
