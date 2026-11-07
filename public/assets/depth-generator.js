// Browser-only depth estimation: first run downloads a model, later runs reuse browser cache.
const panel=document.querySelector('[data-depth-panel]');
if(panel){
 const button=panel.querySelector('[data-depth-generate]');
 const status=panel.querySelector('[data-depth-status]');
 const preview=panel.querySelector('[data-depth-preview]');
 const strength=panel.closest('form').querySelector('[name="parallaxStrength"]');
 button.addEventListener('click',async()=>{
  button.disabled=true;
  try{
   status.textContent='Загрузка модели ИИ (первый запуск может занять несколько минут)…';
   const {pipeline,RawImage,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm');
   env.allowLocalModels=true;
   env.allowRemoteModels=true;
   env.localModelPath='/assets/models/';
   const modelId='onnx-community/depth-anything-v2-small';
   const estimator=await pipeline('depth-estimation',modelId,{device:'webgpu'}).catch(async()=>{
    status.textContent='WebGPU недоступен — запускаю обработку на CPU…';
    return pipeline('depth-estimation',modelId,{device:'wasm'});
   });
   const img=new Image();img.crossOrigin='anonymous';img.src=panel.dataset.image;
   await img.decode();
   // Reduce GPU/CPU memory use. This is a preliminary equirectangular depth estimate.
   const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
   canvas.getContext('2d').drawImage(img,0,0,1024,512);
   status.textContent='Нейросеть вычисляет карту глубины…';
   const source=await RawImage.fromURL(canvas.toDataURL('image/png'));
   const result=await estimator(source);
   const depth=result.depth;
   if(!depth)throw Error('Модель не вернула карту глубины');
   const dc=depth.toCanvas();
   const out=document.createElement('canvas');out.width=1024;out.height=512;
   const ctx=out.getContext('2d');ctx.drawImage(dc,0,0,1024,512);
   // Blend both edges to reduce the visible 360° seam.
   const pixels=ctx.getImageData(0,0,1024,512),data=pixels.data;
   for(let y=0;y<512;y++)for(let x=0;x<32;x++){
    const l=(y*1024+x)*4,r=(y*1024+1023-x)*4;
    const avg=(data[l]+data[r])/2,blend=(32-x)/32;
    for(const i of [l,r]){data[i]=data[i]*(1-blend)+avg*blend;data[i+1]=data[i];data[i+2]=data[i];}
   }
   ctx.putImageData(pixels,0,0);
   preview.src=out.toDataURL('image/png');preview.hidden=false;
   const blob=await new Promise(resolve=>out.toBlob(resolve,'image/png'));
   if(!blob)throw Error('Не удалось создать PNG');
   const form=new FormData();form.append('id',panel.dataset.id);form.append('strength',strength.value);form.append('depth',blob,'depth.png');
   status.textContent='Сохраняю карту глубины на Timeweb…';
   const response=await fetch('/admin/depth-upload.php',{method:'POST',body:form,credentials:'same-origin'});
   const uploadResult=await response.json();if(!response.ok||!uploadResult.ok)throw Error(uploadResult.error||'Ошибка сохранения');
   const saved=panel.querySelector('[data-depth-saved]');if(saved)saved.src=uploadResult.url+'?v='+Date.now();
   const download=panel.querySelector('[data-depth-download]');if(download)download.href=uploadResult.url;
   status.textContent='Карта глубины сохранена. Обновите страницу для просмотра параллакса.';
  }catch(e){status.textContent='Ошибка: '+e.message;console.error('MiniVR depth',e);}
  finally{button.disabled=false;}
 });
}
