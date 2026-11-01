const SHELL_CACHE='minivr-shell-v2',OFFLINE_CACHE='minivr-offline-v1';
const SHELL=['/','/assets/app.css','/assets/home.js','/assets/viewer.css','/assets/viewer.js','/assets/pwa.js','/assets/icons/icon.svg','/assets/vendor/three/three.module.js','/assets/vendor/three/DeviceOrientationControls.js','/assets/vendor/three/effects/VREffect.js','/assets/vendor/three/controls/VRControls.js','/assets/vendor/webvr/webvr-polyfill.min.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(SHELL_CACHE).then(c=>Promise.allSettled(SHELL.map(u=>c.add(u)))).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('minivr-shell-')&&k!==SHELL_CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 const r=e.request;if(r.method!=='GET'||new URL(r.url).origin!==location.origin)return;
 const u=new URL(r.url);
 if(u.pathname.startsWith('/admin/')||u.pathname.startsWith('/api/'))return;
 if(r.mode==='navigate'||u.pathname.startsWith('/uploads/')||u.pathname.startsWith('/tiles/')){
  e.respondWith(fetch(r).catch(async()=>await caches.match(r)||Response.error()));return;
 }
 e.respondWith(fetch(r).then(res=>{if(res.ok&&u.pathname.startsWith('/assets/')){const copy=res.clone();e.waitUntil(caches.open(SHELL_CACHE).then(c=>c.put(r,copy)))}return res}).catch(()=>caches.match(r).then(v=>v||Response.error())));
});
self.addEventListener('message',e=>{
 const msg=e.data||{};if(msg.type!=='MINIVR_OFFLINE_SAVE'&&msg.type!=='MINIVR_OFFLINE_DELETE')return;
 const port=e.ports?.[0];const urls=[...new Set((msg.urls||[]).filter(v=>typeof v==='string'&&v.startsWith('/')&&!v.startsWith('//')&&!v.startsWith('/admin/')))];
 e.waitUntil((async()=>{
  try{
   const cache=await caches.open(OFFLINE_CACHE);
   if(msg.type==='MINIVR_OFFLINE_DELETE'){for(const url of urls)await cache.delete(url);port?.postMessage({ok:true,done:urls.length});return}
   let done=0;for(const url of urls){
    const response=await fetch(url,{credentials:'same-origin',cache:'no-store'});
    if(!response.ok)throw Error('HTTP '+response.status+': '+url);
    await cache.put(url,response);done++;port?.postMessage({progress:done,total:urls.length});
   }
   port?.postMessage({ok:true,done});
  }catch(err){port?.postMessage({ok:false,error:String(err)})}
 })());
});

self.addEventListener('push',event=>{
 let data={};try{data=event.data?.json()||{}}catch{}
 const title=String(data.title||'MiniVR: новая панорама').slice(0,120);
 const options={body:String(data.body||'Откройте новые VR-материалы').slice(0,200),icon:'/assets/icons/icon.svg',badge:'/assets/icons/icon.svg',tag:'minivr-panorama',data:{url:typeof data.url==='string'&&data.url.startsWith('/')&&!data.url.startsWith('//')?data.url:'/' }};
 event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();
 const url=new URL(event.notification.data?.url||'/',self.location.origin);
 event.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(async windows=>{
  for(const client of windows){if(new URL(client.url).origin===url.origin){await client.focus();await client.navigate(url.href);return;}}
  return clients.openWindow(url.href);
 }));
});
