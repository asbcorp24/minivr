// Browser-side AI background generation using a real ONNX DeepFill v2 inpainting model.
// No image data is sent to an AI API; only the finished panorama is uploaded to MiniVR.
const panel=document.querySelector('[data-ai-background]');
if(panel){
 const button=panel.querySelector('[data-ai-generate]'),status=panel.querySelector('[data-ai-status]');
 const preview=panel.querySelector('[data-ai-preview]');
 button?.addEventListener('click',async()=>{
  button.disabled=true;
  let session;
  try{
   if(!panel.dataset.depth)throw Error('Сначала сгенерируйте и сохраните карту глубины, затем обновите страницу.');
   status.textContent='Загрузка ONNX Runtime и нейросети DeepFill v2…';
   const ort=await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.bundle.min.mjs');
   ort.env.wasm.wasmPaths='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';
   ort.env.wasm.numThreads=1;
   const model='https://huggingface.co/vooxyou/deepfillv2-inpainting/resolve/main/deepfillv2_quantized.onnx';
   // Cache model bytes to avoid repeated downloads after the first generation.
   let bytes;
   const cache=typeof caches!=='undefined'?await caches.open('minivr-inpaint-model-v1').catch(()=>null):null;
   let response=cache?await cache.match(model):null;
   if(!response){response=await fetch(model);if(!response.ok)throw Error('Не удалось загрузить модель: HTTP '+response.status);if(cache)await cache.put(model,response.clone()).catch(()=>{});}
   bytes=await response.arrayBuffer();
   session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
   status.textContent='Подготовка маски по карте глубины…';
   const load=async url=>{const img=new Image();img.crossOrigin='anonymous';img.src=url;await img.decode();return img;};
   const [photo,depth]=await Promise.all([load(panel.dataset.image),load(panel.dataset.depth)]);
   const w=512,h=512,makeCanvas=()=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c;};
   const input=makeCanvas(),ctx=input.getContext('2d',{willReadFrequently:true});ctx.drawImage(photo,0,0,w,h);
   const dc=makeCanvas(),dctx=dc.getContext('2d',{willReadFrequently:true});dctx.drawImage(depth,0,0,w,h);
   const rgb=ctx.getImageData(0,0,w,h),dep=dctx.getImageData(0,0,w,h).data;
   const plane=w*h,values=new Float32Array(plane*3),mask=new Float32Array(plane);
   let selected=0;
   for(let i=0;i<plane;i++){
    const near=dep[i*4]/255>.68;
    if(near)selected++;
    mask[i]=near?1:0;
    for(let c=0;c<3;c++)values[c*plane+i]=rgb.data[i*4+c]/255;
   }
   if(selected<100)throw Error('Карта глубины не содержит достаточно ближних объектов.');
   if(selected>plane*.65)throw Error('Слишком большая область маски. Нужна карта с различимым фоном.');
   status.textContent='ИИ восстанавливает скрытый фон. Это может занять несколько минут…';
   const outputs=await session.run({image:new ort.Tensor('float32',values,[1,3,h,w]),mask:new ort.Tensor('float32',mask,[1,1,h,w])});
   const tensor=outputs.output??Object.values(outputs)[0];
   if(!tensor?.data||tensor.data.length<plane*3)throw Error('Модель вернула некорректный результат.');
   // Preserve original unmasked pixels and blend the generated region at the boundary.
   const result=ctx.createImageData(w,h),out=result.data;
   const data=tensor.data;
   let scale=1;for(let i=0;i<Math.min(2000,data.length);i++)if(data[i]>2){scale=255;break;}
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;
    const a=mask[i] ? 1 : 0;
    for(let c=0;c<3;c++)out[i*4+c]=Math.max(0,Math.min(255,rgb.data[i*4+c]*(1-a)+data[c*plane+i]*255/scale*a));
    out[i*4+3]=255;
   }
   ctx.putImageData(result,0,0);
   // Return to 2:1 equirectangular proportions, blending both longitude edges.
   const final=document.createElement('canvas');final.width=1024;final.height=512;
   const fctx=final.getContext('2d',{willReadFrequently:true});fctx.drawImage(input,0,0,1024,512);
   const edge=fctx.getImageData(0,0,1024,512);
   for(let y=0;y<512;y++)for(let x=0;x<16;x++){
    const l=(y*1024+x)*4,r=(y*1024+1023-x)*4,t=(16-x)/16*.5;
    for(let c=0;c<3;c++){const avg=(edge.data[l+c]+edge.data[r+c])*.5;edge.data[l+c]=edge.data[l+c]*(1-t)+avg*t;edge.data[r+c]=edge.data[r+c]*(1-t)+avg*t;}
   }
   fctx.putImageData(edge,0,0);
   preview.src=final.toDataURL('image/png');preview.hidden=false;
   const blob=await new Promise(resolve=>final.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG не создан');
   const form=new FormData();form.append('id',panel.dataset.id);form.append('background',blob,'background.png');
   status.textContent='Сохраняю восстановленный фон на Timeweb…';
   const saved=await fetch('/admin/depth-background-upload.php',{method:'POST',body:form,credentials:'same-origin'});
   const answer=await saved.json();if(!saved.ok||!answer.ok)throw Error(answer.error||'Ошибка сохранения');
   const existing=panel.querySelector('[data-ai-saved]');if(existing)existing.src=answer.url+'?v='+Date.now();
   status.textContent='Фон создан и сохранён. Обновите просмотр панорамы.';
  }catch(err){console.error('MiniVR AI inpainting',err);status.textContent='Ошибка: '+err.message;}
  finally{await session?.release?.().catch(()=>{});button.disabled=false;}
 });
}
