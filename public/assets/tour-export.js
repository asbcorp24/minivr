// Browser-only equirectangular tour recorder. No server-side rendering.
(()=>{
 const root=document.querySelector('[data-minivr-export]');if(!root)return;
 const scenes=JSON.parse(root.dataset.scenes||'[]');
 const start=root.querySelector('#export-start'),stop=root.querySelector('#export-stop'),status=root.querySelector('#export-status');
 const quality=root.querySelector('#export-quality'),fpsField=root.querySelector('#export-fps'),fadeField=root.querySelector('#export-fade');
 const music=root.querySelector('#export-music');
 const canvas=root.querySelector('canvas'),ctx=canvas.getContext('2d',{alpha:false});
 let recorder=null,cancelled=false;
 const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
 const image=url=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=()=>reject(new Error('Не удалось загрузить '+url));img.src=url;});
 function paint(img,opacity=1){ctx.globalAlpha=opacity;ctx.drawImage(img,0,0,canvas.width,canvas.height);ctx.globalAlpha=1;}
 async function render(){
  if(!window.MediaRecorder||!canvas.captureStream)throw Error('Этот браузер не поддерживает запись видео из Canvas.');
  if(!scenes.length)throw Error('Нет сцен.');
  const invalid=scenes.find(s=>s.projection!=='360'||s.stereo!=='mono');
  if(invalid)throw Error('Экспорт 360° поддерживает только моно эквиректангулярные панорамы 360°. Проверьте сцены.');
  const [w,h]=quality.value.split('x').map(Number),fps=Number(fpsField.value);
  canvas.width=w;canvas.height=h;
  const options=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  const mime=options.find(type=>MediaRecorder.isTypeSupported(type));
  if(!mime)throw Error('Браузер не поддерживает MP4 или WebM через MediaRecorder.');
  const stream=canvas.captureStream(fps);
  let sound=null;
  if(music&&music.value){
   sound=new Audio(music.value);
   sound.loop=true;
   sound.crossOrigin='anonymous';
   const ac=new AudioContext();
   const src=ac.createMediaElementSource(sound);
   const gain=ac.createGain();
   gain.gain.value=Number(root.querySelector('#export-volume').value)/100;
   const dest=ac.createMediaStreamDestination();
   src.connect(gain);gain.connect(dest);
   await ac.resume();
   await sound.play();
   dest.stream.getAudioTracks().forEach(t=>stream.addTrack(t));
   sound.context=ac;
  }
  const chunks=[];
  recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:w>=3840?24000000:9000000});
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
  const completed=new Promise((resolve,reject)=>{recorder.onerror=e=>reject(e.error||new Error('Ошибка записи'));recorder.onstop=()=>resolve();});
  recorder.start(1000);cancelled=false;stop.disabled=false;start.disabled=true;
  try{
   let prev=null;
   for(let i=0;i<scenes.length&&!cancelled;i++){
    const scene=scenes[i],img=await image(scene.image);
    const duration=Math.max(1,Math.min(3600,Number(scene.duration_seconds)||10))*1000;
    const fade=Math.min(duration/2,Math.max(0,Number(fadeField.value)*1000));
    const startAt=performance.now();
    while(!cancelled&&performance.now()-startAt<duration){
     const elapsed=performance.now()-startAt;
     ctx.fillStyle='#000';ctx.fillRect(0,0,w,h);
     if(prev&&fade>0&&elapsed<fade){paint(prev);paint(img,Math.min(1,elapsed/fade));}
     else paint(img);
     status.textContent='Запись '+(i+1)+'/'+scenes.length+' · '+Math.floor(elapsed/1000)+' с · '+w+'×'+h;
     await wait(Math.max(16,1000/fps));
    }
    prev=img;
   }
  }finally{
   if(recorder.state!=='inactive')recorder.stop();
   await completed;
   if(sound){sound.pause();await sound.context.close();}
   stream.getTracks().forEach(track=>track.stop());
   recorder=null;start.disabled=false;stop.disabled=true;
  }
  if(!chunks.length)throw Error('Браузер не записал данные.');
  const ext=mime.includes('mp4')?'mp4':'webm';
  const blob=new Blob(chunks,{type:mime});
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download='minivr-tour-'+root.dataset.tour+'.'+ext;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  status.textContent='Готово: '+ext.toUpperCase()+' ('+(blob.size/1048576).toFixed(1)+' МБ). Для YouTube 360° необходимы пространственные метаданные; этот браузерный экспорт их не добавляет.';
 }
 start.addEventListener('click',()=>render().catch(e=>{status.textContent='Ошибка: '+e.message;start.disabled=false;stop.disabled=true;}));
 stop.addEventListener('click',()=>{cancelled=true;status.textContent='Завершение записи…'});
})();
