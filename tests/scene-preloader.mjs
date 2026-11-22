import assert from 'node:assert/strict';
import {createScenePreloader,fetchBoundedBlob,fetchPreparedScene} from '../public/assets/scene-preloader.js';

const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitFor(predicate){for(let i=0;i<60;i++){if(predicate())return;await tick();}throw Error('Timed out waiting for preload');}

// Only scheduled neighbors run, obsolete work is aborted, and the same ready
// scene can be used repeatedly without another download.
{
 const started=[],aborted=[];
 const cache=createScenePreloader({maxEntries:2,maxBytes:10,concurrency:1,prepare:(key,signal)=>{
  started.push(key);
  if(key==='obsolete')return new Promise((resolve,reject)=>{
   signal.addEventListener('abort',()=>{aborted.push(key);reject(Error('aborted'));},{once:true});
  });
  return Promise.resolve({name:key,bytes:5});
 }});
 cache.schedule(['obsolete','next']);
 await waitFor(()=>started.includes('obsolete'));
 cache.schedule(['next']);
 await waitFor(()=>cache.getReady('next')?.name==='next');
 assert.deepEqual(aborted,['obsolete']);
 assert.equal(started.includes('next'),true);
 assert.equal(cache.getReady('next')?.name,'next');
 assert.equal(started.filter(key=>key==='next').length,1,'Ready neighbors must not re-fetch');
 cache.schedule(['later']);
 await waitFor(()=>cache.getReady('later')?.name==='later');
 assert.equal(cache.getReady('next')?.name,'next','Recently used older scene remains cached');
 cache.schedule(['third']);
 await waitFor(()=>cache.getReady('third')?.name==='third');
 assert.equal(cache.getReady('later'),null,'LRU evicts an older scene under memory pressure');
 cache.dispose();
 assert.equal(cache.getReady('third'),null,'Dispose releases cache contents');
}

// Pausing on a hidden tab stops in-flight bandwidth; resuming restarts only
// current desired work, not old irrelevant requests.
{
 let attempts=0,aborts=0;
 const cache=createScenePreloader({prepare:(_key,signal)=>{
  attempts++;
  if(attempts>1)return Promise.resolve({bytes:1});
  return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborts++;reject(Error('paused'));},{once:true}));
 }});
 cache.schedule(['a']);
 await waitFor(()=>attempts===1);
 cache.pause();
 assert.equal(aborts,1);
 cache.resume();
 await waitFor(()=>cache.getReady('a')!==null);
 assert.equal(attempts,2);
 cache.dispose();
}

// Stale ready blobs must expire even when the visitor leaves the tab idle.
{
 const cache=createScenePreloader({maxAgeMs:15,prepare:async()=>({bytes:4})});
 cache.schedule(['idle']);
 await waitFor(()=>cache.getReady('idle')!==null);
 await new Promise(resolve=>setTimeout(resolve,35));
 assert.equal(cache.getReady('idle'),null);
 cache.dispose();
}

// The preloader must never download unrestricted full-size images, and it
// must not issue authenticated requests to a foreign origin or to data: URLs.
{
 const oldFetch=globalThis.fetch;
 const calls=[];
 globalThis.fetch=async url=>{
  calls.push(url);
  return new Response('1234567890',{headers:{'Content-Type':'image/jpeg'}});
 };
 try{
  const signal=new AbortController().signal,base='https://vr.example.test/viewer.php';
  assert.equal(await fetchBoundedBlob('/uploads/large.jpg',5,signal,base),null);
  const blob=await fetchBoundedBlob('/uploads/small.jpg',10,signal,base);
  assert.equal(blob.size,10);
  assert.equal(await fetchBoundedBlob('https://example.org/x.jpg',100,signal,base),null);
  assert.equal(await fetchBoundedBlob('data:image/png;base64,AA==',100,signal,base),null);
  assert.equal(calls.length,2);
 }finally{globalThis.fetch=oldFetch;}
}

// Full scene prefetch stores compressed assets and metadata but deliberately
// does not create any THREE textures or decoded panorama images.
{
 const oldFetch=globalThis.fetch,oldParser=globalThis.DOMParser,oldLocation=globalThis.location;
 const requests=[];
 globalThis.location={href:'https://vr.example.test/viewer.php',origin:'https://vr.example.test'};
 globalThis.DOMParser=class{parseFromString(){return {querySelector:()=>({dataset:{
  image:'/uploads/scene.jpg',tiles:'',projection:'360',stereo:'mono',
  effects:JSON.stringify({parallaxEnabled:true,parallaxDepth:'/uploads/depth.png'})
 }})};}};
 globalThis.fetch=async url=>{
  requests.push(url);
  if(url.includes('viewer.php'))return new Response('<html>scene</html>');
  return new Response('1234',{headers:{'Content-Type':'image/png'}});
 };
 try{
  const data=await fetchPreparedScene('/viewer.php?id=5&tour=2&scene=10',new AbortController().signal,{maxBytes:1024*1024});
  assert.match(data.html,/scene/);
  assert.equal(data.assets.image.size,4);
  assert.equal(data.assets.depth.size,4);
  assert.ok(data.bytes<1024*1024);
  assert.equal(requests.length,3);
 }finally{globalThis.fetch=oldFetch;globalThis.DOMParser=oldParser;globalThis.location=oldLocation;}
}

console.log('scene-preloader: reuse, LRU, cancellation, byte limits and scene resources passed');

// Large tiled scenes need only their manifest and smallest resolution tiles in
// the preloader, never the full-resolution source panorama.
{
 const oldFetch=globalThis.fetch,oldParser=globalThis.DOMParser,oldLocation=globalThis.location;
 const requested=[];
 globalThis.location={href:'https://vr.example.test/viewer.php',origin:'https://vr.example.test'};
 globalThis.DOMParser=class{parseFromString(){return {querySelector:()=>({dataset:{
  image:'/uploads/giant.jpg',tiles:'/tiles/giant/manifest.json',projection:'360',stereo:'mono',effects:'{}'
 }})};}};
 globalThis.fetch=async url=>{
  requested.push(url);
  if(url.includes('/viewer.php'))return new Response('<html>tiled</html>');
  if(url.endsWith('manifest.json'))return Response.json({projection:'360',tileSize:512,levels:[{level:0,width:1024,height:512,cols:2,rows:1}]});
  return new Response('jpeg',{headers:{'Content-Type':'image/jpeg'}});
 };
 try{
  const data=await fetchPreparedScene('/viewer.php?id=3&tour=1&scene=5',new AbortController().signal,{maxBytes:1024*1024});
  assert.equal(data.assets.image,null);
  assert.equal(data.manifest.levels.length,1);
  assert.equal(data.baseTiles.size,2);
  assert.equal(data.baseTiles.get('0/0_0.jpg').size,4);
  assert.equal(requested.some(url=>url.includes('giant.jpg')),false);
 }finally{globalThis.fetch=oldFetch;globalThis.DOMParser=oldParser;globalThis.location=oldLocation;}
}

console.log('scene-preloader: tiled scene base level prefetch passed');
