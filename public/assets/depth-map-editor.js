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
  const layer=root.querySelector('[data-layer]'),showAll=root.querySelector('[data-show-all]'),layerOpacity=root.querySelector('[data-layer-opacity]');
  root.querySelector('[data-layer-photo]').src=root.dataset.image;
  const countInput=panel.closest('form').querySelector('[name="parallaxGroups"]');
  const count=()=>Math.max(2,Math.min(10,Number(countInput?.value)||5));
  function buildLayers(){
   const current=Number(layer.value);
   layer.replaceChildren();
   for(let i=0;i<count();i++){const option=document.createElement('option');option.value=String(i);option.textContent='Слой '+(i+1)+' — '+(i===0?'дальний':i===count()-1?'ближний':'средний');layer.append(option);}
   layer.value=String(Math.min(count()-1,Number.isFinite(current)?current:count()-1));
   if(layer.selectedIndex<0)layer.selectedIndex=count()-1;
   draw();
  }
  function selectedRange(){const n=count(),i=Number(layer.value);return [(i+.5)/n,1/n];}
  function belongs(depth){const [center,halfWidth]=selectedRange();return Math.abs(depth/255-center)<halfWidth;}
  layer.addEventListener('change',()=>draw());showAll.addEventListener('change',()=>draw());layerOpacity.addEventListener('input',()=>draw());
  countInput?.addEventListener('change',buildLayers);
  const history=[],redo=[];let original=null,working=null,painting=false,last=null,dirty=false;
  const buttons={save:root.querySelector('[data-save]'),undo:root.querySelector('[data-undo]'),redo:root.querySelector('[data-redo]'),reset:root.querySelector('[data-reset]'),restore:root.querySelector('[data-restore]')};
  const W=512,H=256;canvas.width=W;canvas.height=H;
  function snapshot(){history.push(new Uint8ClampedArray(working.data));if(history.length>20)history.shift();redo.length=0;}
  function renderOverlay(){
   if(!working)return;
   const frame=ctx.createImageData(W,H),d=frame.data;
   const alpha=Math.round(Number(layerOpacity.value)/100*255);
   for(let i=0;i<W*H;i++){
    const v=working.data[i*4],active=belongs(v);
    if(!showAll.checked&&!active)continue;
    const j=i*4;
    if(showAll.checked){
     const shade=Math.round(v/255*210);
     d[j]=shade;d[j+1]=Math.round(75+shade*.35);d[j+2]=255-shade;d[j+3]=Math.round(alpha*.65);
    }else{d[j]=255;d[j+1]=95;d[j+2]=35;d[j+3]=alpha;}
   }
   ctx.putImageData(frame,0,0);
  }
  function draw(){renderOverlay();buttons.undo.disabled=!history.length;buttons.redo.disabled=!redo.length;buttons.save.disabled=!dirty;}
  function setPixels(pixels){working.data.set(pixels);dirty=true;draw();}
  async function load(){
   const img=new Image();img.src=saved.src;await img.decode();
   ctx.drawImage(img,0,0,W,H);original=ctx.getImageData(0,0,W,H);
   working=ctx.createImageData(W,H);working.data.set(original.data);dirty=false;buildLayers();draw();
  }
  function paint(x,y){
   const r=Number(brush.value),[center]=selectedRange(),v=Math.round(center*255),a=Number(opacity.value)/100;
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
    const exportCanvas=document.createElement('canvas');exportCanvas.width=W;exportCanvas.height=H;
    exportCanvas.getContext('2d').putImageData(working,0,0);
    const blob=await new Promise(resolve=>exportCanvas.toBlob(resolve,'image/png'));
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
