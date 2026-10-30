(()=>{
const audio=document.querySelector('#music-audio'),root=document.querySelector('#music-player'),data=document.querySelector('#music-tracks-data');
if(!audio||!root||!data)return;
let tracks=[];try{tracks=JSON.parse(data.textContent)}catch(e){console.warn('Music playlist invalid',e)}
if(!tracks.length)return;
const KEY='minivr:music:v2',title=root.querySelector('.music-title'),artist=root.querySelector('.music-artist'),toggle=root.querySelector('.music-toggle');
let index=0,wantsPlay=false,restoring=false;
let state={};try{state=JSON.parse(sessionStorage.getItem(KEY)||'{}')}catch(e){}
index=Math.max(0,tracks.findIndex(t=>t.file_path===state.file_path));if(index<0)index=0;
function save(){try{sessionStorage.setItem(KEY,JSON.stringify({file_path:tracks[index].file_path,time:audio.currentTime||0,playing:!audio.paused||wantsPlay,updated:Date.now()}))}catch(e){}}
function load(i,play=false,time=0){index=(i+tracks.length)%tracks.length;audio.src=tracks[index].file_path;title.textContent=tracks[index].title;artist.textContent=tracks[index].artist||'MiniVR';wantsPlay=play;if(time>0){audio.addEventListener('loadedmetadata',function seek(){audio.removeEventListener('loadedmetadata',seek);if(Number.isFinite(audio.duration))audio.currentTime=Math.min(time,Math.max(0,audio.duration-.25))},{once:true})}if(play)audio.play().catch(()=>{toggle.textContent='▶'});save()}
toggle.addEventListener('click',()=>{if(audio.paused){wantsPlay=true;audio.play().catch(()=>{})}else{wantsPlay=false;audio.pause()}save()});
root.querySelector('.music-prev').addEventListener('click',()=>load(index-1,true));
root.querySelector('.music-next').addEventListener('click',()=>load(index+1,true));
root.querySelector('.music-minimize')?.addEventListener('click',()=>{root.classList.toggle('minimized');root.querySelector('.music-meta').style.display=root.classList.contains('minimized')?'none':''});
audio.addEventListener('ended',()=>load(index+1,true));
audio.addEventListener('play',()=>{wantsPlay=true;toggle.textContent='❚❚';save()});
audio.addEventListener('pause',()=>{toggle.textContent='▶';save()});
audio.addEventListener('timeupdate',()=>{if(Math.floor(audio.currentTime)%3===0)save()});
window.addEventListener('pagehide',save);
const initialTrack=Number(document.querySelector('#viewer')?.dataset.musicTrack||0);
const selectedIndex=initialTrack?tracks.findIndex(t=>Number(t.id)===initialTrack):-1;
load(selectedIndex>=0?selectedIndex:index,selectedIndex>=0?true:!!state.playing,selectedIndex>=0?0:Number(state.time)||0);
window.addEventListener('minivr:scene-music',e=>{
 const trackId=Number(e.detail?.trackId||0);
 const i=tracks.findIndex(t=>Number(t.id)===trackId);
 if(i>=0){if(i!==index)load(i,true,0);else{audio.currentTime=0;audio.play().catch(()=>{})}}
 else{audio.pause();wantsPlay=false;toggle.textContent='▶'}
});
if(state.playing){const retry=()=>{if(wantsPlay&&audio.paused)audio.play().catch(()=>{});document.removeEventListener('pointerdown',retry)};document.addEventListener('pointerdown',retry,{once:true})}
})();