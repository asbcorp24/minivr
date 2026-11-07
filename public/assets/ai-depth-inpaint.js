// Browser-side AI background generation using LaMa ONNX inpainting.
// No image data is sent to an AI API; only the finished panorama is uploaded to MiniVR.
const panel=document.querySelector('[data-ai-background]');
if(panel){
 const button=panel.querySelector('[data-ai-generate]'),status=panel.querySelector('[data-ai-status]');
 const preview=panel.querySelector('[data-ai-preview]');
 const maskCanvas=panel.querySelector('[data-ai-mask-canvas]');
 const compareCanvas=panel.querySelector('[data-ai-compare]');
 const maskPixels=new Uint8Array(1024*512);
 let maskReady=false,maskMode=1,maskDrawing=false,originalImage=null,resultImage=null;
 const loadImage=async url=>{const image=new Image();image.crossOrigin='anonymous';image.src=url;await image.decode();return image;};
 const drawCompare=async(result=false)=>{
  const canvas=compareCanvas;if(!canvas)return;
  const image=result&&resultImage?resultImage:originalImage;
  if(!image)return;
  const context=canvas.getContext('2d');context.clearRect(0,0,1024,512);context.drawImage(image,0,0,1024,512);
 };
 panel.querySelector('[data-ai-show-original]')?.addEventListener('click',()=>drawCompare(false));
 panel.querySelector('[data-ai-show-result]')?.addEventListener('click',()=>drawCompare(true));
 const showResult=async url=>{resultImage=await loadImage(url);drawCompare(true);};
 const paintMask=()=>{
  if(!maskCanvas||!originalImage)return;
  const ctx=maskCanvas.getContext('2d');ctx.clearRect(0,0,1024,512);ctx.drawImage(originalImage,0,0,1024,512);
  const overlay=ctx.createImageData(1024,512);
  for(let i=0;i<maskPixels.length;i++)if(maskPixels[i]){overlay.data[i*4]=255;overlay.data[i*4+3]=125;}
  ctx.putImageData(overlay,0,0);
 };
 const resetMask=async()=>{
  if(!panel.dataset.depth)return;
  const depth=await loadImage(panel.dataset.depth),c=document.createElement('canvas');c.width=1024;c.height=512;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(depth,0,0,1024,512);
  const pixels=ctx.getImageData(0,0,1024,512).data;
  // Relative depth map: bright = near. Use percentile-based separation rather
  // than a fixed 0.68 threshold, and reject smooth gradients with no objects.
  const w=1024,h=512,depthValues=new Uint8Array(w*h),hist=new Uint32Array(256);
  for(let i=0;i<depthValues.length;i++){const v=pixels[i*4];depthValues[i]=v;hist[v]++;}
  const percentile=q=>{let count=0;for(let i=0;i<256;i++){count+=hist[i];if(count>=w*h*q)return i;}return 255;};
  const low=percentile(.10),high=percentile(.90);
  if(high-low<18){maskPixels.fill(0);maskReady=true;paintMask();status.textContent='На карте глубины недостаточно контраста. Уточните маску вручную.';return;}
  const sensitivity=Number(panel.querySelector('[data-ai-depth-sensitivity]')?.value||65)/100;
  const cutoff=low+(high-low)*sensitivity;
  // Select complete near-depth regions, not depth discontinuity outlines.
  // Depth maps represent distance, not semantic object classes.
  // Exclude bottom-connected floor/ground only when it forms a large area;
  // preserve smaller foreground objects even when they touch the bottom.
  const candidate=new Uint8Array(w*h);
  for(let i=0;i<candidate.length;i++)candidate[i]=depthValues[i]>=cutoff?1:0;
  const seen=new Uint8Array(w*h),queue=new Int32Array(w*h);
  maskPixels.fill(0);
  for(let start=0;start<w*h;start++){
   if(!candidate[start]||seen[start])continue;
   let head=0,tail=1,touchesBottom=false,top=h,bottom=0;
   queue[0]=start;seen[start]=1;
   while(head<tail){
    const i=queue[head++],x=i%w,y=(i/w)|0;
    if(y===h-1)touchesBottom=true;
    if(y<top)top=y;if(y>bottom)bottom=y;
    const left=y*w+(x+w-1)%w,right=y*w+(x+1)%w;
    if(candidate[left]&&!seen[left]){seen[left]=1;queue[tail++]=left;}
    if(candidate[right]&&!seen[right]){seen[right]=1;queue[tail++]=right;}
    if(y>0&&candidate[i-w]&&!seen[i-w]){seen[i-w]=1;queue[tail++]=i-w;}
    if(y<h-1&&candidate[i+w]&&!seen[i+w]){seen[i+w]=1;queue[tail++]=i+w;}
   }
   const broadGround=touchesBottom&&tail>w*h*.12&&bottom-top>h*.15;
   if(tail>=40&&!broadGround)for(let k=0;k<tail;k++)maskPixels[queue[k]]=1;
  }
  // Small dilation covers anti-aliased silhouette edges. Wrap longitude.
  const expanded=maskPixels.slice();
  for(let y=2;y<h-2;y++)for(let x=0;x<w;x++){
   const i=y*w+x;if(!maskPixels[i])continue;
   for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)expanded[(y+dy)*w+(x+dx+w)%w]=1;
  }
  maskPixels.set(expanded);
  maskReady=true;paintMask();
  const coverage=maskPixels.reduce((sum,value)=>sum+value,0)/maskPixels.length;
  status.textContent='Автоматическая маска по карте глубины: '+(coverage*100).toFixed(1)+'% площади. Красным показаны участки для восстановления.';
 };
 if(maskCanvas){
  loadImage(panel.dataset.image).then(img=>{originalImage=img;drawCompare(false);return resetMask();}).catch(err=>{console.warn('MiniVR mask editor',err);status.textContent='Не удалось загрузить редактор маски: '+err.message;});
  panel.querySelector('[data-ai-mask-add]')?.addEventListener('click',()=>{maskMode=1;});
  panel.querySelector('[data-ai-mask-erase]')?.addEventListener('click',()=>{maskMode=0;});
  panel.querySelector('[data-ai-mask-reset]')?.addEventListener('click',()=>resetMask().catch(console.error));
  panel.querySelector('[data-ai-depth-sensitivity]')?.addEventListener('input',()=>resetMask().catch(console.error));
  const stroke=event=>{
   if(!maskReady)return;
   const rect=maskCanvas.getBoundingClientRect(),x=Math.floor((event.clientX-rect.left)*1024/rect.width),y=Math.floor((event.clientY-rect.top)*512/rect.height);
   const radius=Number(panel.querySelector('[data-ai-mask-size]')?.value||24);
   for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    if(dx*dx+dy*dy>radius*radius)continue;
    const yy=y+dy;if(yy<0||yy>=512)continue;
    const xx=(x+dx+1024)%1024;maskPixels[yy*1024+xx]=maskMode;
   }
   paintMask();
  };
  maskCanvas.addEventListener('pointerdown',event=>{maskDrawing=true;maskCanvas.setPointerCapture(event.pointerId);stroke(event);});
  maskCanvas.addEventListener('pointermove',event=>{if(maskDrawing)stroke(event);});
  maskCanvas.addEventListener('pointerup',()=>{maskDrawing=false;});
  maskCanvas.addEventListener('pointercancel',()=>{maskDrawing=false;});
 }
 const getMask=(w,h)=>{
  const result=new Float32Array(w*h);
  if(!maskReady)return null;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)result[y*w+x]=maskPixels[Math.floor(y*512/h)*1024+Math.floor(x*1024/w)];
  return result;
 };

 // Automatically derive five depth-group masks and transparent 2:1 PNG layers.
 // No separate AI invocation is needed for segmentation.
 const buildDepthLayers=async()=>{
  if(!panel.dataset.depth)throw Error('Сначала сохраните карту глубины');
  const count=Math.max(2,Math.min(10,Number(panel.dataset.groups)||5));
  const [photo,depthImage]=await Promise.all([loadImage(panel.dataset.image),loadImage(panel.dataset.depth)]);
  const w=1024,h=512,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(photo,0,0,w,h);
  const original=ctx.getImageData(0,0,w,h).data;
  ctx.clearRect(0,0,w,h);ctx.drawImage(depthImage,0,0,w,h);
  const depths=ctx.getImageData(0,0,w,h).data;
  const form=new FormData();form.append('id',panel.dataset.id);
  const outputs=[];
  for(let group=0;group<count;group++){
   const center=(group+.5)/count,soft=.25/count;
   const frame=ctx.createImageData(w,h);
   for(let i=0;i<w*h;i++){
    const d=depths[i*4]/255,dist=Math.abs(d-center);
    const alpha=Math.max(0,Math.min(1,(.5/count+soft-dist)/soft));
    const k=i*4;frame.data[k]=original[k];frame.data[k+1]=original[k+1];frame.data[k+2]=original[k+2];frame.data[k+3]=Math.round(alpha*255);
   }
   ctx.putImageData(frame,0,0);
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   if(!blob)throw Error('Не удалось создать PNG слоя '+(group+1));
   form.append('layers[]',blob,'layer_'+(group+1)+'.png');
   outputs.push(URL.createObjectURL(blob));
  }
  try{
   status.textContent='Сохраняю '+count+' слоёв глубины…';
   const response=await fetch('/admin/depth-layers-upload.php',{method:'POST',body:form,credentials:'same-origin'});
   const result=await response.json();
   if(!response.ok||!result.ok)throw Error(result.error||'Ошибка сохранения слоёв');
   status.textContent='Сохранено '+count+' слоёв PNG. Маски построены автоматически по карте глубины.';
  }finally{for(const url of outputs)URL.revokeObjectURL(url);}
 };
 panel.querySelector('[data-ai-generate-layers]')?.addEventListener('click',async event=>{
  const btn=event.currentTarget;btn.disabled=true;
  try{await buildDepthLayers();}catch(err){console.error(err);status.textContent='Ошибка слоёв: '+err.message;}
  finally{btn.disabled=false;}
 });
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
  const edited=getMask(w,h);
  const mask=new Uint8Array(w*h),known=new Uint8Array(w*h),frontier=[];
  for(let i=0;i<known.length;i++){mask[i]=edited?edited[i]:dp[i*4]>174?1:0;known[i]=mask[i]?0:1;}
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
  await showResult(preview.src);
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
   const plane=w*h,values=new Float32Array(plane*3),mask=getMask(w,h)||new Float32Array(plane);
   let selected=0;
   for(let i=0;i<plane;i++){
    const near=dep[i*4]/255>.68;
    if(mask[i])selected++;
    if(!maskReady)mask[i]=near?1:0;
    for(let c=0;c<3;c++)values[c*plane+i]=rgb.data[i*4+c]/255;
   }
   if(selected<100)throw Error('Карта глубины не содержит достаточно ближних объектов.');
   if(selected>plane*.65)throw Error('Слишком большая область маски. Увеличьте порог глубины или удалите лишние участки кистью.');
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
   await showResult(preview.src);
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
