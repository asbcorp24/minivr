// Browser-side AI background generation using LaMa ONNX inpainting.
// No image data is sent to an AI API; only the finished panorama is uploaded to MiniVR.
const panel=document.querySelector('[data-ai-background]');
if(panel){
 const button=panel.querySelector('[data-ai-generate]'),status=panel.querySelector('[data-ai-status]');
 const preview=panel.querySelector('[data-ai-preview]');
 const bar=panel.querySelector('[data-ai-progress]'),percent=panel.querySelector('[data-ai-percent]');
 const setProgress=(value,label)=>{
  const n=Math.max(0,Math.min(100,Math.round(value)));
  if(bar){bar.value=n;bar.setAttribute('aria-valuenow',String(n));}
  if(percent)percent.textContent=n+'%';
  if(label)status.textContent=label;
 };
 // Stream the model response so download progress reflects actual bytes.
 async function downloadModel(response){
  const total=Number(response.headers.get('content-length'))||0;
  if(!response.body||!total){setProgress(8,'Загрузка модели (размер не сообщён сервером)…');return response.arrayBuffer();}
  const reader=response.body.getReader(),chunks=[];let received=0;
  while(true){
   const {done,value}=await reader.read();if(done)break;
   chunks.push(value);received+=value.byteLength;
   setProgress(5+Math.min(45,received/total*45),'Загрузка модели: '+(received/1048576).toFixed(1)+' / '+(total/1048576).toFixed(1)+' МБ');
  }
  const bytes=new Uint8Array(received);let offset=0;
  for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  return bytes.buffer;
 }
 // Safe non-AI fallback: propagate neighboring background colors into the
 // foreground mask. The original depth map and panorama remain unchanged.
 async function generateFallbackBackground(){
  const load=async url=>{const img=new Image();img.crossOrigin='anonymous';img.src=url;await img.decode();return img;};
  setProgress(82,'Резервное заполнение фона…');
  const [photo,depth]=await Promise.all([load(panel.dataset.image),load(panel.dataset.depth)]);
  const w=1024,h=512,c=document.createElement('canvas');c.width=w;c.height=h;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(photo,0,0,w,h);
  const d=document.createElement('canvas');d.width=w;d.height=h;
  const dc=d.getContext('2d',{willReadFrequently:true});dc.drawImage(depth,0,0,w,h);
  const frame=ctx.getImageData(0,0,w,h),px=frame.data,dp=dc.getImageData(0,0,w,h).data;
  const mask=new Uint8Array(w*h),known=new Uint8Array(w*h),frontier=[];
  for(let i=0;i<known.length;i++){mask[i]=dp[i*4]>174?1:0;known[i]=mask[i]?0:1;}
  for(let i=0;i<known.length;i++)if(!known[i]){
   const x=i%w,y=(i/w)|0;
   const n=[y*w+(x+w-1)%w,y*w+(x+1)%w];
   if(y>0)n.push(i-w);if(y<h-1)n.push(i+w);
   if(n.some(j=>known[j]))frontier.push(i);
  }
  let current=frontier;
  for(let step=0;step<Math.max(w,h)&&current.length;step++){
   const next=[];
   for(const i of current){
    if(known[i])continue;
    const x=i%w,y=(i/w)|0,n=[y*w+(x+w-1)%w,y*w+(x+1)%w];
    if(y>0)n.push(i-w);if(y<h-1)n.push(i+w);
    let r=0,g=0,b=0,count=0;
    for(const j of n)if(known[j]){r+=px[j*4];g+=px[j*4+1];b+=px[j*4+2];count++;}
    if(!count)continue;
    px[i*4]=r/count;px[i*4+1]=g/count;px[i*4+2]=b/count;
    known[i]=2;
    for(const j of n)if(!known[j])next.push(j);
   }
   for(const i of current)if(known[i]===2)known[i]=1;
   current=next;
  }
  ctx.putImageData(frame,0,0);
  preview.src=c.toDataURL('image/png');preview.hidden=false;
  const blob=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
  if(!blob)throw Error('Не удалось создать PNG');
  const form=new FormData();form.append('id',panel.dataset.id);form.append('background',blob,'background.png');
  setProgress(95,'Сохранение фона…');
  const response=await fetch('/admin/depth-background-upload.php',{method:'POST',body:form,credentials:'same-origin'});
  const result=await response.json();
  if(!response.ok||!result.ok)throw Error(result.error||'Ошибка сохранения');
  const saved=panel.querySelector('[data-ai-saved]');if(saved)saved.src=result.url+'?v='+Date.now();
  setProgress(100,'Создан и сохранён приближённый фон без ИИ. Обновите просмотр.');
 }
 button?.addEventListener('click',async()=>{
  button.disabled=true;
  setProgress(0,'Начинаю обработку…');
  let session;
  try{
   if(!panel.dataset.depth)throw Error('Сначала сгенерируйте и сохраните карту глубины, затем обновите страницу.');
   status.textContent='Загрузка ONNX Runtime и нейросети LaMa…';
   const ort=await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/ort.bundle.min.mjs');
   ort.env.wasm.wasmPaths='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.26.0/dist/';
   ort.env.wasm.numThreads=1;
   const model='/assets/models/lama_fp32.onnx';
   const remoteModel='https://huggingface.co/edgetools/lama/resolve/main/lama_fp32.onnx';
   // Cache model bytes to avoid repeated downloads after the first generation.
   let bytes;
   const cache=typeof caches!=='undefined'?await caches.open('minivr-lama-model-v1').catch(()=>null):null;
   let response=cache?await cache.match(model):null;
   if(!response){response=await fetch(model).catch(()=>null);if(!response?.ok){response=await fetch(remoteModel);if(!response.ok)throw Error('Не удалось загрузить LaMa: HTTP '+response.status);}if(cache)await cache.put(model,response.clone()).catch(()=>{});}
   bytes=await downloadModel(response);
   setProgress(55,'Инициализация нейросети…');
   try{
    session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
   }catch(error){
    if(/ExtractImagePatches|No Op registered|not implemented|unsupported/i.test(String(error))){
     status.textContent='Модель LaMa не запустилась в ONNX Runtime Web. Переключаюсь на локальное заполнение фона…';
     await generateFallbackBackground();
     return;
    }
    throw error;
   }
   setProgress(65,'Подготовка маски по карте глубины…');
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
   setProgress(75,'ИИ восстанавливает скрытый фон. Во время вычисления процент не меняется…');
   const outputs=await session.run({image:new ort.Tensor('float32',values,[1,3,h,w]),mask:new ort.Tensor('float32',mask,[1,1,h,w])});
   setProgress(85,'Обработка результата нейросети…');
   const tensor=outputs.output??Object.values(outputs)[0];
   if(!tensor?.data||tensor.data.length<plane*3)throw Error('Модель вернула некорректный результат.');
   // Preserve original unmasked pixels and blend the generated region at the boundary.
   const result=ctx.createImageData(w,h),out=result.data;
   const data=tensor.data;
   // LaMa outputs RGB values in the 0..255 range (not 0..1).
   const scale=255;
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
   setProgress(95,'Сохраняю восстановленный фон на Timeweb…');
   const saved=await fetch('/admin/depth-background-upload.php',{method:'POST',body:form,credentials:'same-origin'});
   const answer=await saved.json();if(!saved.ok||!answer.ok)throw Error(answer.error||'Ошибка сохранения');
   const existing=panel.querySelector('[data-ai-saved]');if(existing)existing.src=answer.url+'?v='+Date.now();
   setProgress(100,'Фон создан и сохранён. Обновите просмотр панорамы.');
  }catch(err){console.error('MiniVR AI inpainting',err);status.textContent='Ошибка: '+err.message;}
  finally{await session?.release?.().catch(()=>{});button.disabled=false;}
 });
}
