// Network-only tour scene cache. No GPU textures, renderer objects or decoded
// full-size panoramas are kept alive between scene switches.
export function createScenePreloader({prepare, maxEntries=3, maxBytes=24*1024*1024, concurrency=1, maxAgeMs=120000}) {
 const entries=new Map();
 let desired=[],active=0,paused=false,disposed=false,tick=0;

 function remove(key){
  const entry=entries.get(key);
  if(!entry)return;
  entries.delete(key);
  if(entry.expiryTimer)clearTimeout(entry.expiryTimer);
  entry.controller?.abort();
 }
 function trim(){
  const now=Date.now();
  for(const [key,entry] of entries){
   if(entry.state==='ready'&&now-entry.created>maxAgeMs)remove(key);
  }
  const ready=()=>Array.from(entries.entries()).filter(([,entry])=>entry.state==='ready');
  let items=ready();
  let bytes=items.reduce((total,[,entry])=>total+entry.bytes,0);
  while(items.length>maxEntries||bytes>maxBytes){
   // An old scene goes first; a likely next scene is retained if possible.
   items.sort((a,b)=>Number(desired.includes(a[0]))-Number(desired.includes(b[0]))||a[1].used-b[1].used);
   const [key,entry]=items.shift();
   bytes-=entry.bytes;
   remove(key);
  }
 }
 function pump(){
  if(disposed||paused)return;
  for(const key of desired){
   if(active>=concurrency)break;
   const entry=entries.get(key);
   if(!entry||entry.state!=='queued')continue;
   const controller=new AbortController();
   entry.state='loading';entry.controller=controller;
   active++;
   Promise.resolve().then(()=>prepare(key,controller.signal)).then(data=>{
    if(disposed||controller.signal.aborted||entries.get(key)!==entry)return;
    if(!data||!Number.isFinite(data.bytes)||data.bytes<0||data.bytes>maxBytes){entries.delete(key);return;}
    entry.value=data;entry.bytes=data.bytes;entry.state='ready';entry.created=Date.now();entry.used=++tick;
    entry.expiryTimer=setTimeout(()=>{if(entries.get(key)===entry)remove(key);},maxAgeMs);
    entry.expiryTimer.unref?.();
    trim();
   }).catch(()=>{if(entries.get(key)===entry)entries.delete(key)})
    .finally(()=>{active--;pump()});
  }
 }
 function schedule(urls){
  if(disposed)return;
  desired=Array.from(new Set(urls)).slice(0,2);
  for(const [key,entry] of entries){
   if((entry.state==='loading'||entry.state==='queued')&&!desired.includes(key))remove(key);
  }
  for(const key of desired)if(!entries.has(key))entries.set(key,{state:'queued',used:++tick});
  trim();pump();
 }
 function getReady(url){
  if(disposed)return null;
  trim();
  const entry=entries.get(url);
  if(!entry||entry.state!=='ready')return null;
  entry.used=++tick;
  return entry.value;
 }
 function cancel(url){
  const entry=entries.get(url);
  if(entry&&entry.state!=='ready')remove(url);
 }
 function pause(){
  paused=true;
  for(const [key,entry] of entries)if(entry.state!=='ready')remove(key);
 }
 function resume(){if(disposed)return;paused=false;schedule(desired);}
 function dispose(){disposed=true;pause();entries.clear();desired=[];}
 return {schedule,getReady,cancel,pause,resume,dispose};
}

// A response size can be missing or incorrect; read incrementally and stop
// before an unexpectedly large original panorama fills mobile device memory.
export async function fetchBoundedBlob(url,maxBytes,signal,baseUrl){
 if(!url||maxBytes<=0)return null;
 let target;
 try{target=new URL(url,baseUrl)}catch{return null;}
 const base=new URL(baseUrl);
 if(target.origin!==base.origin||!['https:','http:'].includes(target.protocol))return null;
 const response=await fetch(target.href,{credentials:'same-origin',signal});
 if(!response.ok)return null;
 const announced=Number(response.headers.get('content-length'));
 if(announced>maxBytes){await response.body?.cancel?.();return null;}
 if(!response.body?.getReader){const blob=await response.blob();return blob.size<=maxBytes?blob:null;}
 const reader=response.body.getReader(),chunks=[];
 let bytes=0;
 for(;;){
  const {done,value}=await reader.read();
  if(done)break;
  bytes+=value.byteLength;
  if(bytes>maxBytes){await reader.cancel();return null;}
  chunks.push(value);
 }
 return new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
}

export async function fetchPreparedScene(url,signal,{maxBytes=24*1024*1024}={}){
 const baseUrl=new URL(url,location.href).href;
 if(new URL(baseUrl).origin!==location.origin)throw new Error('Only same-origin tours can be preloaded');
 const response=await fetch(baseUrl,{credentials:'same-origin',signal});
 if(!response.ok)throw new Error('Scene HTTP '+response.status);
 const html=await response.text();
 const doc=new DOMParser().parseFromString(html,'text/html');
 const viewer=doc.querySelector('#viewer');
 if(!viewer)throw new Error('Scene data missing');
 let settings={};try{settings=JSON.parse(viewer.dataset.effects||'{}')}catch{}
 const projection=viewer.dataset.projection||'360',stereo=viewer.dataset.stereo||'mono';
 const useTiles=projection==='360'&&stereo==='mono'&&viewer.dataset.tiles&&
  !(settings.parallaxEnabled&&settings.parallaxDepth);
 const remaining=Math.max(0,maxBytes-html.length*2-16384);
 const sizes={image:Math.floor(remaining*.75),depth:Math.floor(remaining*.12),foliage:Math.floor(remaining*.06),water:Math.floor(remaining*.06)};
 const sources={
  image:useTiles?null:viewer.dataset.image,
  depth:projection==='360'&&stereo==='mono'&&settings.parallaxEnabled?settings.parallaxDepth:null,
  foliage:settings.parallaxFoliageMask,
  water:settings.parallaxWaterMotion?settings.parallaxWaterMask:null
 };
 const assets={};
 await Promise.all(Object.keys(sources).map(async key=>{
  try{assets[key]=await fetchBoundedBlob(sources[key],sizes[key],signal,baseUrl)}
  catch(error){if(signal.aborted)throw error;assets[key]=null;}
 }));
 let manifest=null,baseTiles=null;
 if(useTiles){
  try{
   const manifestUrl=new URL(viewer.dataset.tiles,baseUrl);
   if(manifestUrl.origin===location.origin){
    const manifestResponse=await fetch(manifestUrl.href,{credentials:'same-origin',signal});
    if(manifestResponse.ok){
     const candidate=await manifestResponse.json();
     if(candidate.projection==='360'&&Array.isArray(candidate.levels)&&candidate.levels.length){
      manifest=candidate;baseTiles=new Map();
      const level=candidate.levels[0],count=level.cols*level.rows;
      if(count>0&&count<=8){
       const limit=Math.floor(remaining*.75/count),base=manifestUrl.href.slice(0,manifestUrl.href.lastIndexOf('/')+1);
       await Promise.all(Array.from({length:count},async(_,i)=>{
        const path=level.level+'/'+(i%level.cols)+'_'+Math.floor(i/level.cols)+'.jpg';
        const blob=await fetchBoundedBlob(new URL(path,base).href,limit,signal,baseUrl);
        if(blob)baseTiles.set(path,blob);
       }));
      }
     }
    }
   }
  }catch(error){if(signal.aborted)throw error;manifest=null;baseTiles=null;}
 }
 let bytes=html.length*2+JSON.stringify(manifest||{}).length;
 for(const blob of Object.values(assets))bytes+=blob?.size||0;
 for(const blob of baseTiles?.values()||[])bytes+=blob.size;
 // A very large HTML payload or unexpected tile sizes must not escape the cap.
 if(bytes>maxBytes){assets.image=null;baseTiles=null;bytes=html.length*2+JSON.stringify(manifest||{}).length;
  for(const [key,blob] of Object.entries(assets)){if(key!=='image')bytes+=blob?.size||0;}}
 return {html,assets,manifest,baseTiles,bytes};
}
