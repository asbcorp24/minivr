(()=>{const btn=document.getElementById('offline-save'),root=document.getElementById('viewer');if(!btn||!root)return;btn.addEventListener('click',async()=>{
 if(!('serviceWorker'in navigator)||!('caches'in window)){alert('Офлайн-режим требует HTTPS и поддержку Service Worker');return}
 btn.disabled=true;btn.textContent='СОХРАНЕНИЕ…';
 try{
  const registration=await navigator.serviceWorker.ready;const worker=registration.active;if(!worker)throw Error('Service Worker не активен');
  const urls=new Set([location.pathname+location.search,root.dataset.image]);
  const tour=JSON.parse(document.getElementById('tour-data')?.textContent||'{}');
  for(const scene of tour.scenes||[]){if(scene.image)urls.add(scene.image);if(scene.preview)urls.add(scene.preview);if(scene.panorama_id&&scene.id)urls.add('/viewer.php?id='+encodeURIComponent(scene.panorama_id)+'&tour='+encodeURIComponent(root.dataset.tour||0)+'&scene='+encodeURIComponent(scene.id))}
  if(root.dataset.tiles){const manifest=await fetch(root.dataset.tiles).then(r=>r.json());urls.add(root.dataset.tiles);const base=root.dataset.tiles.slice(0,root.dataset.tiles.lastIndexOf('/')+1);for(const level of manifest.levels||[])for(let y=0;y<level.rows;y++)for(let x=0;x<level.cols;x++)urls.add(base+level.level+'/'+x+'_'+y+'.jpg')}
  const channel=new MessageChannel();const done=new Promise((resolve,reject)=>{channel.port1.onmessage=e=>{const m=e.data||{};if(m.progress)btn.textContent='СОХРАНЕНО '+m.progress+'/'+m.total;if(m.ok===true)resolve(m);if(m.ok===false)reject(Error(m.error))}});
  worker.postMessage({type:'MINIVR_OFFLINE_SAVE',urls:[...urls]},[channel.port2]);await done;
  btn.textContent='✓ OFFLINE';alert('Панорама'+(tour.scenes?.length?' и сцены тура':'')+' сохранена для просмотра без интернета. Для офлайн-запуска сначала откройте установленное PWA.');
 }catch(err){console.error(err);btn.textContent='↓ OFFLINE';alert('Не удалось сохранить офлайн: '+err.message)}
 finally{btn.disabled=false}
})})();