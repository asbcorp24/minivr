// Reuses the same Transformers.js Depth Anything v2 model and WebGPU/WASM
// runtime as the existing panorama depth-generator.js. Runs only in the admin browser.
const panels=document.querySelectorAll('[data-stereo-depth-panel]');
let estimatorPromise;
async function getEstimator(status){
  if(!estimatorPromise)estimatorPromise=(async()=>{
    const {pipeline,RawImage,env}=await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.7.6/+esm');
    env.allowLocalModels=false;
    const model='onnx-community/depth-anything-v2-small';
    const estimator=await pipeline('depth-estimation',model,{device:'webgpu'}).catch(async()=>{
      status.textContent='WebGPU недоступен. Запускаю WASM…';
      return pipeline('depth-estimation',model,{device:'wasm'});
    });
    return {estimator,RawImage};
  })().catch(e=>{estimatorPromise=null;throw e});
  return estimatorPromise;
}
function imageToCanvas(image,sx,sy,sw,sh,w,h){
  const c=document.createElement('canvas');c.width=w;c.height=h;
  c.getContext('2d').drawImage(image,sx,sy,sw,sh,0,0,w,h);return c;
}
async function infer(estimator,RawImage,canvas){
  const input=await RawImage.fromURL(canvas.toDataURL('image/png'));
  const result=await estimator(input);
  if(!result.depth)throw Error('Модель не вернула карту глубины');
  const c=document.createElement('canvas');c.width=canvas.width;c.height=canvas.height;
  c.getContext('2d').drawImage(result.depth.toCanvas(),0,0,c.width,c.height);
  const rgba=c.getContext('2d',{willReadFrequently:true}).getImageData(0,0,c.width,c.height).data;
  const out=new Float32Array(c.width*c.height);
  for(let i=0;i<out.length;i++)out[i]=rgba[i*4]/255;
  return out;
}
function normalize(data){
  const values=Array.from(data).filter(Number.isFinite).sort((a,b)=>a-b);
  const lo=values[Math.floor(values.length*.03)]??0,hi=values[Math.floor(values.length*.97)]??1;
  const scale=Math.max(.01,hi-lo);
  return Float32Array.from(data,x=>Math.max(0,Math.min(1,(x-lo)/scale)));
}
function buildMap(left,right,w,h){
  // Two neural depth predictions are combined, with left-eye details favored.
  // Disagreement is suppressed to avoid geometry spikes on clouds and water.
  const l=normalize(left),r=normalize(right),out=document.createElement('canvas');
  out.width=w;out.height=h;const ctx=out.getContext('2d'),pixels=ctx.createImageData(w,h);
  for(let i=0;i<w*h;i++){
    const diff=Math.abs(l[i]-r[i]);
    const agreement=Math.max(0,1-diff*2);
    const d=l[i]*(1-.22*agreement)+r[i]*(.22*agreement);
    const v=Math.round(d*255);
    const k=i*4;pixels.data[k]=v;pixels.data[k+1]=v;pixels.data[k+2]=v;pixels.data[k+3]=255;
  }
  ctx.putImageData(pixels,0,0);return out;
}
for(const panel of panels){
  const button=panel.querySelector('[data-stereo-depth-generate]');
  const status=panel.querySelector('[data-stereo-depth-status]');
  const preview=panel.querySelector('[data-stereo-depth-preview]');
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try{
      status.textContent='Загружаю Depth Anything v2 (модель кэшируется браузером)…';
      const {estimator,RawImage}=await getEstimator(status);
      const image=new Image();image.crossOrigin='anonymous';image.src=panel.dataset.image;await image.decode();
      const sbs=panel.dataset.format==='sbs';
      const eyeW=sbs?image.naturalWidth/2:image.naturalWidth;
      const eyeH=sbs?image.naturalHeight:image.naturalHeight/2;
      if(eyeW<64||eyeH<64)throw Error('Слишком маленькая стереопара');
      const w=Math.min(768,Math.round(eyeW)),h=Math.max(64,Math.round(w*eyeH/eyeW));
      const left=imageToCanvas(image,0,0,eyeW,eyeH,w,h);
      const right=imageToCanvas(image,sbs?eyeW:0,sbs?0:eyeH,eyeW,eyeH,w,h);
      status.textContent='Нейросеть: левый ракурс…';
      const ld=await infer(estimator,RawImage,left);
      status.textContent='Нейросеть: правый ракурс…';
      const rd=await infer(estimator,RawImage,right);
      const output=buildMap(ld,rd,w,h);
      const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));
      if(!blob)throw Error('Не удалось создать PNG');
      const localURL=URL.createObjectURL(blob);
      preview.src=localURL;preview.hidden=false;
      status.textContent='Сохраняю карту глубины…';
      const form=new FormData();
      form.append('scene',panel.dataset.scene);form.append('hotspot',panel.dataset.id);
      form.append('csrf',panel.dataset.csrf);form.append('depth',blob,'stereo-depth.png');
      const response=await fetch('/admin/stereo-depth-upload.php',{method:'POST',body:form,credentials:'same-origin'});
      const result=await response.json();
      if(!response.ok||!result.ok)throw Error(result.error||'Ошибка сохранения');
      preview.src=result.url+'?v='+Date.now();URL.revokeObjectURL(localURL);
      const link=panel.querySelector('[data-stereo-depth-link]');if(link)link.href=result.url;
      button.textContent='↻ Пересоздать карту AI';
      status.textContent='Карта глубины сохранена. Живое 3D Pro использует готовый PNG.';
    }catch(error){console.error('Stereo depth AI',error);status.textContent='Ошибка: '+error.message}
    finally{button.disabled=false}
  });
}
