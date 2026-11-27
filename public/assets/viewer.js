import {createBloomPipeline} from '/assets/panorama-bloom.js';
import {createPanorama3DObjects} from '/assets/panorama-3d-objects.js';
import {createEnvironment} from '/assets/panorama-environment.js';
import {createMoonlight} from '/assets/panorama-moonlight.js';
import {createAtmosphere} from '/assets/panorama-atmosphere.js';
import {createPanoramaEffects} from '/assets/panorama-effects.js';
import {createTiledPanorama} from '/assets/tiled-panorama.js';
import {seamBlurAmount,installPanoramaSeamShader} from '/assets/panorama-seam-blur.js';
import {makeDepthRadiusField,canUseTiledDepth} from '/assets/depth-tile-geometry.js';
import {createScenePreloader,fetchPreparedScene} from '/assets/scene-preloader.js';
import {createDesktop3DWindow} from '/assets/desktop-3d-window.js';
import {createMobileMotionParallax} from '/assets/mobile-motion-parallax.js';
import {requestGyroSample,validGyroSample,GYRO_SAMPLE_TIMEOUT_MS} from '/assets/gyro-sensor.js';
import {canTranslateDepthCamera,depthOffsetInWorld} from '/assets/depth-motion.js';
import {shouldSwitchSceneInPlace} from '/assets/tour-navigation.js';
import {viewerTargetWithEmbed} from '/assets/embed-navigation.js';
import {tourScenePoint,tourMapEmbedUrl,tourMapExternalUrl} from '/assets/tour-geo-map.js';
import {createTourAudioGuide,isTourAudioUrl} from '/assets/tour-audio-guide.js';
import * as THREE from '/assets/vendor/three/three.module.js';
import DeviceOrientationControls from '/assets/vendor/three/DeviceOrientationControls.js';
import VREffect from '/assets/vendor/three/effects/VREffect.js';
import VRControls from '/assets/vendor/three/controls/VRControls.js';

const root=document.querySelector('#viewer');
const immersiveLaunch=new URLSearchParams(location.search).get('immersive')==='1';
if(immersiveLaunch){
 document.documentElement.classList.add('minivr-immersive-launch');
 const immersiveCss=document.createElement('style');
 immersiveCss.textContent='.minivr-immersive-launch #top{display:none!important}.minivr-immersive-launch #viewer{position:fixed!important;inset:0!important;width:100vw!important;height:100dvh!important}';
 document.head.appendChild(immersiveCss);
 // Browsers normally prohibit requestFullscreen without a user gesture.
 // Try once on arrival; otherwise activate on the first intentional click.
 const requestFullscreen=()=>{if(!document.fullscreenElement&&document.documentElement.requestFullscreen)document.documentElement.requestFullscreen().catch(()=>{});};
 document.addEventListener('pointerdown',requestFullscreen,{once:true,capture:true});
 requestFullscreen();
}

let effectSettings={};try{effectSettings=JSON.parse(root.dataset.effects||'{}')}catch(e){}
effectSettings.timeOfDay=false;effectSettings.dayCycle=false;
let effectSystem=null,atmosphereSystem=null,moonSystem=null,environmentSystem=null,lastEffectTime=0;
let panoramaObjectSystem=null;let panoramaObjectData=[];try{panoramaObjectData=JSON.parse(root.getAttribute('data-3d-objects')||'[]')}catch(e){}
let bloomPipeline=null;let bloomStrength=panoramaObjectData.filter(o=>o.bloom&&o.visible!==false).reduce((m,o)=>Math.max(m,Number(o.bloomStrength)||1.2),0);
// Opt-in diagnostics: /viewer.php?id=...&effects_debug=1
if(new URLSearchParams(location.search).has('effects_debug')){
 const diagnostic=document.createElement('pre');
 diagnostic.id='minivr-effects-diagnostics';
 diagnostic.style.cssText='position:fixed;top:56px;left:8px;z-index:999999;max-width:min(94vw,440px);max-height:55vh;overflow:auto;background:rgba(0,0,0,.88);color:#aaffcc;padding:12px;border:1px solid #5b9;font:12px/1.45 monospace;white-space:pre-wrap;pointer-events:none';
 const report=()=>{diagnostic.textContent='MiniVR / effects debug\\n'+JSON.stringify(effectSettings,null,2)+'\\nModules: '+[!!effectSystem,!!atmosphereSystem,!!moonSystem,!!environmentSystem].join(' / ')};
 document.addEventListener('DOMContentLoaded',()=>{document.body.appendChild(diagnostic);report()});
 window.addEventListener('error',e=>{diagnostic.textContent+='\\nERROR: '+e.message});
 window.addEventListener('unhandledrejection',e=>{diagnostic.textContent+='\\nREJECTION: '+String(e.reason)});
}

let projection=root.dataset.projection||'360', stereoMode=root.dataset.stereo||'mono';
const tour=Number(root.dataset.tour||0),backUrl=root.dataset.back||'/',embedToken=root.dataset.embedToken||'';let hotspotData=JSON.parse(document.querySelector('#hotspots-data')?.textContent||'[]');
const tourData=JSON.parse(document.querySelector('#tour-data')?.textContent||'{"scenes":[],"current":-1}');
// Keep only compressed network assets for adjacent scenes; the GPU still owns
// exactly one active panorama. On phones the cache is smaller and sequential.
const preloadIsMobile=window.matchMedia('(pointer: coarse)').matches;
const preloadBudget=(preloadIsMobile?12:32)*1024*1024;
const scenePreloader=createScenePreloader({
 prepare:(url,signal)=>fetchPreparedScene(url,signal,{maxBytes:preloadBudget}),
 maxBytes:preloadBudget,maxEntries:preloadIsMobile?2:3,concurrency:preloadIsMobile?1:2
});
const preloadSaveData=navigator.connection?.saveData||['slow-2g','2g'].includes(navigator.connection?.effectiveType);
function tourSceneUrl(index){
 const item=tourData.scenes[index];
 if(!item)return null;
 const target=viewerTargetWithEmbed(new URL('/viewer.php?id='+item.panorama_id+'&tour='+tour+'&scene='+item.id+(immersiveLaunch?'&immersive=1':''),location.href),location.origin,embedToken);
 return target.pathname+target.search;
}
function scheduleNeighborScenes(){
 if(!tour||preloadSaveData||document.visibilityState==='hidden'||tourData.current<0)return;
 const index=tourData.current;
 const candidates=[index+1,index-1,index+2].filter(i=>i>=0&&i<tourData.scenes.length);
 scenePreloader.schedule(candidates.slice(0,2).map(tourSceneUrl).filter(Boolean));
}
function queueNeighborPreload(){if(tour&&!preloadSaveData)setTimeout(scheduleNeighborScenes,700);}
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState==='hidden')scenePreloader.pause();
 else if(!preloadSaveData){scenePreloader.resume();scheduleNeighborScenes();}
});
window.addEventListener('pagehide',()=>scenePreloader.dispose());
// Each panorama may contain its own ordered narrative stops.
function sceneNarrationPoints(){
 const raw=tourData.scenes[tourData.current]?.guided_points;
 let points=[];try{points=typeof raw==='string'?JSON.parse(raw):raw}catch{}
 return Array.isArray(points)?points.filter(p=>Number.isFinite(Number(p.yaw))&&Number.isFinite(Number(p.pitch))&&Number(p.duration)>0).slice(0,50):[];
}
let guidedPoints=sceneNarrationPoints();
let guidedIndex=-1,guidedTimer=null,guidedTarget=null,guidedPanel=null;
let guidedDurationPassed=false,guidedAudioFinished=true,sceneAudioButton=null;
let guidedEnabled=!!tour&&guidedPoints.length>0;
function syncSceneAudioButton(){
 if(!sceneAudioButton)return;
 sceneAudioButton.disabled=tourPaused||narration.pointActive()||narration.sceneFinished();
 sceneAudioButton.textContent=narration.pointActive()?'🎙 Комментарий точки':narration.sceneFinished()?'✓ Рассказ завершён':narration.scenePlaying()?'⏸ Аудиогид':'▶ Аудиогид';
}
const narration=createTourAudioGuide({
 onVoiceChange(active){
  window.__minivrVoiceActive=active;
  window.dispatchEvent(new CustomEvent('minivr:narration-active',{detail:{active}}));
  syncSceneAudioButton();
 },
 onSceneEnded(){syncSceneAudioButton();resetTourTimer();},
 onAutoplayBlocked(role){
  if(role==='point'&&guidedPanel){
   const hint=guidedPanel.querySelector('[data-guided-audio]');
   hint.hidden=false;
   hint.onclick=()=>narration.retryCurrent();
  }
  syncSceneAudioButton();
 }
});
function guidedClearTimer(){if(guidedTimer){clearTimeout(guidedTimer);guidedTimer=null}}
function guidedTryAdvance(){if(guidedDurationPassed&&guidedAudioFinished&&!tourPaused)guidedShow(guidedIndex+1)}
function guidedShow(index){
 guidedClearTimer();narration.finishPoint();guidedDurationPassed=false;guidedAudioFinished=true;
 if(index>=guidedPoints.length){guidedIndex=guidedPoints.length;guidedTarget=null;if(guidedPanel)guidedPanel.hidden=true;resetTourTimer();return}
 guidedIndex=index;const p=guidedPoints[index];
 guidedTarget={yaw:Number(p.yaw),pitch:Number(p.pitch)};
 if(guidedPanel){
  guidedPanel.hidden=false;guidedPanel.querySelector('[data-guided-heading]').textContent=(index+1)+' / '+guidedPoints.length+' · '+(p.title||'Точка экскурсии');
  guidedPanel.querySelector('[data-guided-text]').textContent=p.text||'';
  guidedPanel.querySelector('[data-guided-next]').textContent=index===guidedPoints.length-1?'Завершить рассказ →':'Следующая точка →';
  const hint=guidedPanel.querySelector('[data-guided-audio]');hint.hidden=true;hint.onclick=null;
 }
 if(isTourAudioUrl(p.audio)){
  guidedAudioFinished=false;
  narration.playPoint(p.audio,()=>{guidedAudioFinished=true;guidedTryAdvance();syncSceneAudioButton()});
 }
 syncSceneAudioButton();
 if(!tourPaused)guidedTimer=setTimeout(()=>{guidedDurationPassed=true;guidedTryAdvance()},Math.max(1,Math.min(600,Number(p.duration)))*1000);
}
function guidedPauseResume(){
 guidedClearTimer();narration.setPaused(tourPaused);
 if(!tourPaused&&guidedIndex>=0&&guidedIndex<guidedPoints.length){
  if(guidedDurationPassed)guidedTryAdvance();
  else guidedTimer=setTimeout(()=>{guidedDurationPassed=true;guidedTryAdvance()},Math.max(1,Math.min(600,Number(guidedPoints[guidedIndex].duration)))*1000);
 }
 syncSceneAudioButton();
}
function guidedSetup(){
 guidedClearTimer();narration.stop();guidedPanel?.remove();guidedPanel=null;sceneAudioButton?.remove();sceneAudioButton=null;guidedIndex=-1;guidedTarget=null;
 if(tour){
  narration.setPaused(tourPaused);
  if(narration.setScene(tourData.scenes[tourData.current]?.scene_audio)){
   sceneAudioButton=document.createElement('button');sceneAudioButton.type='button';sceneAudioButton.id='minivr-scene-audio-toggle';
   sceneAudioButton.style.cssText='position:fixed;top:92px;left:12px;z-index:830;border:1px solid #58c3d2;border-radius:10px;padding:9px 12px;background:#092734ed;color:#e0fbff;font:600 12px system-ui;max-width:200px;cursor:pointer';
   sceneAudioButton.setAttribute('aria-label','Воспроизвести или приостановить аудиогид сцены');
   sceneAudioButton.onclick=()=>{narration.toggleScene();syncSceneAudioButton()};
   document.body.append(sceneAudioButton);
   syncSceneAudioButton();
  }
 }
 if(!guidedEnabled){resetTourTimer();return;}
 guidedPanel=document.createElement('aside');guidedPanel.id='minivr-guided-points';
 guidedPanel.style.cssText='position:fixed;bottom:64px;left:50%;transform:translateX(-50%);width:min(390px,calc(100vw - 24px));max-height:40vh;overflow:auto;z-index:850;color:white;background:rgba(12,29,42,.88);border:1px solid #477b8b;border-radius:10px;padding:10px 12px;box-shadow:0 5px 20px #0007;backdrop-filter:blur(8px)';
 const heading=document.createElement('strong');heading.dataset.guidedHeading='';heading.style.cssText='display:block;font-size:12px;line-height:1.3';
 const description=document.createElement('p');description.dataset.guidedText='';description.style.cssText='white-space:pre-wrap;font-size:12px;line-height:1.4;margin:6px 0;max-height:14vh;overflow:auto';
 const controls=document.createElement('div');controls.style.cssText='display:flex;gap:6px;flex-wrap:wrap';
 const next=document.createElement('button');next.type='button';next.dataset.guidedNext='';next.onclick=()=>guidedShow(guidedIndex+1);next.style.cssText='padding:7px 9px;font-size:10px';
 const pause=document.createElement('button');pause.type='button';pause.textContent='⏯ Пауза / продолжить';pause.onclick=()=>{tourPaused=!tourPaused;guidedPauseResume();resetTourTimer()};pause.style.cssText='padding:7px 9px;font-size:10px';
 const audio=document.createElement('button');audio.type='button';audio.dataset.guidedAudio='';audio.textContent='▶ Включить аудио';audio.hidden=true;
 controls.append(next,pause,audio);guidedPanel.append(heading,description,controls);document.body.append(guidedPanel);
 guidedShow(0);
 resetTourTimer();
}
// Guided tour: each scene has its own duration; 0 disables automatic advance.
let tourTimer=null,tourDeadline=0,tourPaused=false;
function currentTourDuration(){
 const item=tourData.scenes[tourData.current];
 const override=item?.duration_seconds;
 const fallback=Number(effectSettings.tourDuration??30);
 return Math.max(0,Math.min(3600,Number(override===null||override===undefined?fallback:override)||0));
}
const tourButton=document.createElement('button');
tourButton.type='button';tourButton.id='tour-autoplay';tourButton.style.cssText='background:#153849;color:white;border:1px solid #43849d;border-radius:8px;padding:7px 10px;cursor:pointer';
tourButton.addEventListener('click',()=>{tourPaused=!tourPaused;guidedPauseResume();resetTourTimer()});
function resetTourTimer(){
 if(tourTimer){clearTimeout(tourTimer);tourTimer=null}
 if(guidedEnabled&&guidedIndex<guidedPoints.length)return;
 const duration=currentTourDuration();
 const next=tourData.current+1<tourData.scenes.length;
 if(narration.hasScene()){
  tourButton.textContent=tourPaused?'▶ Продолжить экскурсию':narration.sceneFinished()?'✓ Рассказ завершён':'🎧 Идёт аудиогид';
  // The recording sets the scene's duration; do not cut it at the old timer.
  if(tour&&next&&narration.sceneFinished()&&!tourPaused&&document.getElementById('minivr-tour-geo-map')?.hidden!==false){
   tourTimer=setTimeout(()=>{tourTimer=null;if(document.visibilityState==='visible'&&!tourPaused)goScene(tourData.current+1)},750);
  }
  return;
 }
 tourButton.textContent=tourPaused?'▶ Продолжить экскурсию':'⏸ Авто: '+duration+' с';
 tourButton.title='Автоматический переход к следующей панораме';
 // Do not advance a scene while someone is reading its location on the map.
 if(!tour||!next||!duration||tourPaused||document.getElementById('minivr-tour-geo-map')?.hidden===false)return;
 tourDeadline=Date.now()+duration*1000;
 tourTimer=setTimeout(()=>{tourTimer=null;if(!tourPaused&&document.visibilityState==='visible')goScene(tourData.current+1);else resetTourTimer()},duration*1000);
}
if(tour&&tourData.scenes.length>1){document.querySelector('#controls')?.prepend(tourButton);resetTourTimer()}
document.addEventListener('visibilitychange',()=>{if(tour&&document.visibilityState==='visible')resetTourTimer();else if(tourTimer){clearTimeout(tourTimer);tourTimer=null}});
// Tour scene rail on desktop, compact previous/next controls on phones.
const tourRail=document.createElement('nav');
tourRail.id='minivr-tour-rail';
tourRail.setAttribute('aria-label','Панорамы экскурсии');
tourRail.style.cssText='position:fixed;right:clamp(12px,2vw,28px);top:50%;transform:translateY(-50%);z-index:800;display:flex;flex-direction:column;align-items:center;gap:11px;padding:15px 11px;border:1px solid rgba(255,255,255,.18);border-radius:28px;background:rgba(12,29,42,.52);backdrop-filter:blur(14px);box-shadow:0 8px 32px #0004;max-height:75vh;overflow-y:auto;scrollbar-width:thin';
const railStyle=document.createElement('style');
railStyle.textContent='#minivr-tour-rail button{appearance:none;position:relative;width:12px;height:12px;min-height:12px;border-radius:50%;border:2px solid rgba(230,246,255,.75);background:rgba(255,255,255,.28);cursor:pointer;transition:transform .2s,background .2s,box-shadow .2s;padding:0}#minivr-tour-rail button:hover,#minivr-tour-rail button:focus-visible{transform:scale(1.3);background:#8defff;outline:none;box-shadow:0 0 0 5px #78eaff35}#minivr-tour-rail button[aria-current="step"]{width:15px;height:15px;min-height:15px;background:#85efff;border-color:#fff;box-shadow:0 0 0 5px #67d9ff35,0 0 14px #67d9ff}#minivr-tour-rail button::before{content:attr(data-label);position:absolute;right:calc(100% + 20px);top:50%;transform:translateY(-50%) translateX(5px);opacity:0;pointer-events:none;white-space:nowrap;max-width:240px;overflow:hidden;text-overflow:ellipsis;color:white;background:#112b3deF;border:1px solid #ffffff35;border-radius:9px;padding:8px 12px;font:13px system-ui;transition:opacity .15s,transform .15s}#minivr-tour-rail button:hover::before,#minivr-tour-rail button:focus-visible::before{opacity:1;transform:translateY(-50%) translateX(0)}@media(max-width:767px){#minivr-tour-rail{display:none!important}}';
railStyle.textContent+='#minivr-tour-rail #minivr-tour-map-toggle{width:29px;height:29px;min-height:29px;display:grid;place-items:center;border-radius:10px;background:#174858;border-color:#61dbe9;font-size:18px;line-height:1}#minivr-tour-rail #minivr-tour-map-toggle:focus-visible{outline:2px solid #fff;outline-offset:3px}#minivr-tour-rail .minivr-tour-rail-count{font:600 10px system-ui;color:#c0f6ff;white-space:nowrap}';
document.head.appendChild(railStyle);
function syncTourRail(){
 const desktop=window.innerWidth>=768&&!cardboard&&!legacyCardboard&&!(typeof renderer!=='undefined'&&renderer.xr.isPresenting);
 tourRail.style.display=desktop?'flex':'none';
 for(const [i,button] of Array.from(tourRail.querySelectorAll('[data-tour-scene]')).entries()){
  if(i===tourData.current){button.setAttribute('aria-current','step');button.setAttribute('aria-label','Текущая панорама: '+(tourData.scenes[i]?.title||'Панорама '+(i+1)))}else{button.removeAttribute('aria-current');button.setAttribute('aria-label','Перейти: '+(tourData.scenes[i]?.title||'Панорама '+(i+1)))}
 }
}
const tourRailCount=document.createElement('span');tourRailCount.className='minivr-tour-rail-count';tourRailCount.setAttribute('role','progressbar');tourRailCount.setAttribute('aria-label','Прогресс экскурсии');tourRailCount.setAttribute('aria-valuemin','0');tourRailCount.setAttribute('aria-valuemax','100');
if(tour&&tourData.scenes.length){
 tourData.scenes.forEach((item,i)=>{const b=document.createElement('button');b.type='button';b.dataset.tourScene=String(i);b.dataset.label=(i+1)+'. '+(item.title||'Панорама '+(i+1));b.title=b.dataset.label;b.addEventListener('click',()=>goScene(i));tourRail.appendChild(b)});
 tourRail.appendChild(tourRailCount);
 document.body.appendChild(tourRail);
 window.addEventListener('resize',syncTourRail);requestAnimationFrame(syncTourRail);
}
// Keep manual scene navigation visible on small screens without covering the view.
const mobileTourNav=document.createElement('nav');
mobileTourNav.id='minivr-mobile-tour-nav';
mobileTourNav.setAttribute('aria-label','Переключение панорам экскурсии');
const mobileTourPrev=document.createElement('button');mobileTourPrev.type='button';mobileTourPrev.textContent='‹';mobileTourPrev.setAttribute('aria-label','Предыдущая панорама');
const mobileTourCount=document.createElement('span');mobileTourCount.setAttribute('aria-live','polite');
const mobileTourNext=document.createElement('button');mobileTourNext.type='button';mobileTourNext.textContent='›';mobileTourNext.setAttribute('aria-label','Следующая панорама');
const mobileTourMap=document.createElement('button');mobileTourMap.type='button';mobileTourMap.id='minivr-mobile-tour-map';mobileTourMap.textContent='⌖';mobileTourMap.setAttribute('aria-label','Открыть реальную карту экскурсии');mobileTourMap.title='Карта';
mobileTourMap.setAttribute('aria-controls','minivr-tour-geo-map');mobileTourMap.setAttribute('aria-expanded','false');
mobileTourPrev.addEventListener('click',()=>goScene(tourData.current-1));
mobileTourNext.addEventListener('click',()=>goScene(tourData.current+1));
mobileTourNav.append(mobileTourPrev,mobileTourCount,mobileTourNext,mobileTourMap);
if(tour&&tourData.scenes.length){document.body.appendChild(mobileTourNav);syncMobileTourNav();}
function syncMobileTourNav(){
 const count=tourData.scenes.length,index=tourData.current;
 mobileTourCount.textContent=(index+1)+' / '+count;
 mobileTourPrev.disabled=index<=0;mobileTourNext.disabled=index<0||index>=count-1;
 mobileTourNav.setAttribute('aria-label','Панорама '+(index+1)+' из '+count+'. Переключение панорам экскурсии');
}

// Real geographical map opens on demand. The right-hand rail remains the tour
// navigator; only stops with explicit GPS coordinates receive map markers.
const tourMap=document.createElement('section');tourMap.id='minivr-tour-geo-map';tourMap.hidden=true;
tourMap.setAttribute('role','dialog');tourMap.setAttribute('aria-modal','true');tourMap.setAttribute('aria-label','Географическая карта экскурсии');
const tourMapPanel=document.createElement('div');tourMapPanel.className='minivr-tour-geo-panel';
const tourMapHeader=document.createElement('header');tourMapHeader.className='minivr-tour-geo-header';
const tourMapHeading=document.createElement('strong');tourMapHeading.textContent='Карта экскурсии';
const tourMapClose=document.createElement('button');tourMapClose.type='button';tourMapClose.textContent='×';tourMapClose.setAttribute('aria-label','Закрыть карту');
tourMapHeader.append(tourMapHeading,tourMapClose);
const tourMapSelectLabel=document.createElement('label');tourMapSelectLabel.className='minivr-tour-geo-select';tourMapSelectLabel.textContent='Показать точку';
const tourMapSelect=document.createElement('select');tourMapSelect.setAttribute('aria-label','Выберите панораму на карте');tourMapSelectLabel.append(tourMapSelect);
const tourMapStatus=document.createElement('p');tourMapStatus.className='minivr-tour-geo-status';tourMapStatus.setAttribute('aria-live','polite');
const tourMapFrame=document.createElement('iframe');tourMapFrame.className='minivr-tour-geo-frame';tourMapFrame.title='Интерактивная карта OpenStreetMap с точкой панорамы';tourMapFrame.loading='lazy';tourMapFrame.referrerPolicy='strict-origin-when-cross-origin';
const tourMapActions=document.createElement('div');tourMapActions.className='minivr-tour-geo-actions';
const tourMapVisit=document.createElement('button');tourMapVisit.type='button';tourMapVisit.textContent='▶ Открыть панораму';
const tourMapExternal=document.createElement('a');tourMapExternal.target='_blank';tourMapExternal.rel='noopener noreferrer';tourMapExternal.textContent='Открыть в OpenStreetMap ↗';
tourMapActions.append(tourMapVisit,tourMapExternal);
const tourMapAttribution=document.createElement('small');tourMapAttribution.textContent='Подложка: © участники OpenStreetMap. Отмечаются только сцены с координатами.';
tourMapPanel.append(tourMapHeader,tourMapSelectLabel,tourMapStatus,tourMapFrame,tourMapActions,tourMapAttribution);tourMap.append(tourMapPanel);
const tourMapToggle=document.createElement('button');tourMapToggle.type='button';tourMapToggle.id='minivr-tour-map-toggle';tourMapToggle.textContent='⌖';tourMapToggle.title='Карта экскурсии';tourMapToggle.dataset.label='Открыть географическую карту';
tourMapToggle.setAttribute('aria-label','Открыть географическую карту экскурсии');tourMapToggle.setAttribute('aria-controls','minivr-tour-geo-map');tourMapToggle.setAttribute('aria-expanded','false');
let selectedTourMapScene=-1,tourMapReturnFocus=null;
function showTourMapPoint(index){
 const point=tourScenePoint(tourData.scenes[index]);
 selectedTourMapScene=point?index:-1;
 tourMapFrame.hidden=!point;tourMapActions.hidden=!point;
 if(!point){tourMapFrame.removeAttribute('src');tourMapStatus.textContent='Для этой экскурсии пока не заданы координаты. Добавьте широту и долготу в админке → Экскурсии → Настроить сцену.';return}
 tourMapSelect.value=String(index);
 tourMapStatus.textContent=(tourData.scenes[index]?.title||'Панорама '+(index+1))+' · '+point.lat.toFixed(5)+', '+point.lng.toFixed(5);
 const src=tourMapEmbedUrl(point);
 if(tourMapFrame.getAttribute('src')!==src)tourMapFrame.src=src;
 tourMapExternal.href=tourMapExternalUrl(point);
 tourMapVisit.disabled=index===tourData.current;
 tourMapVisit.textContent=index===tourData.current?'✓ Текущая панорама':'▶ Открыть панораму';
}
function setTourMapOpen(open){
 if(open){
  tourMapReturnFocus=document.activeElement;
  tourMapSelect.replaceChildren();
  const located=tourData.scenes.map((item,i)=>tourScenePoint(item)?i:-1).filter(i=>i>=0);
  for(const i of located){const option=document.createElement('option');option.value=String(i);option.textContent=(i+1)+'. '+(tourData.scenes[i]?.title||'Панорама');tourMapSelect.appendChild(option)}
  tourMapSelectLabel.hidden=!located.length;
  tourMap.hidden=false;
  if(tourTimer){clearTimeout(tourTimer);tourTimer=null}
  showTourMapPoint(located.includes(tourData.current)?tourData.current:(located[0]??-1));
  tourMapClose.focus();
 }else{
  tourMap.hidden=true;tourMapFrame.removeAttribute('src');
  tourMapReturnFocus?.focus?.();tourMapReturnFocus=null;
  resetTourTimer();
 }
 tourMapToggle.setAttribute('aria-expanded',String(open));
 mobileTourMap.setAttribute('aria-expanded',String(open));
}
tourMapToggle.addEventListener('click',()=>setTourMapOpen(tourMap.hidden));
mobileTourMap.addEventListener('click',()=>setTourMapOpen(tourMap.hidden));
tourMapClose.addEventListener('click',()=>setTourMapOpen(false));
tourMap.addEventListener('click',event=>{if(event.target===tourMap)setTourMapOpen(false)});
tourMapSelect.addEventListener('change',()=>showTourMapPoint(Number(tourMapSelect.value)));
tourMapVisit.addEventListener('click',()=>{if(selectedTourMapScene>=0&&selectedTourMapScene!==tourData.current){const index=selectedTourMapScene;setTourMapOpen(false);goScene(index)}});
document.addEventListener('keydown',event=>{if(tourMap.hidden)return;if(event.key==='Escape'){setTourMapOpen(false)}else if(event.key==='Tab'){
 const focusables=Array.from(tourMapPanel.querySelectorAll('button:not(:disabled),select:not(:disabled),a[href]')).filter(el=>!el.closest('[hidden]'));
 if(!focusables.length)return;
 const first=focusables[0],last=focusables[focusables.length-1];
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
}});
function syncTourMap(){
 const total=tourData.scenes.length,index=Math.max(0,Math.min(total-1,tourData.current));
 const percent=total>1?Math.round(index/(total-1)*100):100;
 tourRailCount.textContent=(index+1)+'/'+total;
 tourRailCount.setAttribute('aria-valuenow',String(percent));
 tourRailCount.setAttribute('aria-valuetext','Панорама '+(index+1)+' из '+total);
 if(!tourMap.hidden&&tourScenePoint(tourData.scenes[tourData.current]))showTourMapPoint(tourData.current);
}
if(tour&&tourData.scenes.length){
 tourRail.appendChild(tourMapToggle);
 document.body.appendChild(tourMap);syncTourMap();
}

const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,.1,1100);
effectSystem=createPanoramaEffects(scene,effectSettings);atmosphereSystem=createAtmosphere(scene,effectSettings);moonSystem=createMoonlight(scene,effectSettings);environmentSystem=createEnvironment(scene,effectSettings);
createPanorama3DObjects(scene,camera,panoramaObjectData).then(system=>{panoramaObjectSystem=system;}).catch(error=>console.warn('MiniVR 3D objects unavailable',error));
let renderer;
try{
 renderer=new THREE.WebGLRenderer({antialias:false,powerPreference:'default',preserveDrawingBuffer:false});
 bloomPipeline=createBloomPipeline(renderer);
 renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.5));
 renderer.xr.enabled=true;
 root.appendChild(renderer.domElement);
 renderer.domElement.addEventListener('webglcontextlost',event=>{
  event.preventDefault();
  console.warn('MiniVR: WebGL context lost; waiting for browser restoration');
  let notice=document.getElementById('minivr-webgl-notice');
  if(!notice){notice=document.createElement('div');notice.id='minivr-webgl-notice';notice.style.cssText='position:absolute;z-index:9999;inset:20px auto auto 20px;padding:16px;background:#172631;color:white;border-radius:10px;max-width:380px';root.appendChild(notice)}
  notice.textContent='Графический контекст потерян. Закройте другие 3D-вкладки и дождитесь восстановления.';
 },false);
 renderer.domElement.addEventListener('webglcontextrestored',()=>{
  document.getElementById('minivr-webgl-notice')?.remove();
  console.info('MiniVR: WebGL context restored');
 },false);
}catch(error){
 console.error('MiniVR: WebGL initialization failed',error);
 const notice=document.createElement('div');notice.style.cssText='padding:24px;background:#182e3b;color:#fff;max-width:600px;margin:30px auto;border-radius:12px';
 notice.textContent='Не удалось запустить 3D-просмотр: WebGL заблокирован браузером. Закройте другие вкладки с 3D, перезапустите браузер и проверьте аппаратное ускорение.';
 root.appendChild(notice);
 throw error;
}
let cardboard=false,lon=0,lat=0,down=false,x0=0,y0=0,lon0=0,lat0=0,orientation=false,leftMesh,rightMesh,seamRotationPaused=false;
const cardboardStereo=new THREE.StereoCamera();cardboardStereo.eyeSep=.064;
const legacyVREffect=new VREffect(renderer);const legacyVRControls=new VRControls(camera);let legacyVRDisplay=null,legacyCardboard=false;
const ViewerMode=Object.freeze({DESKTOP:'desktop',CARDBOARD:'cardboard',WEBXR:'webxr'});
function getViewerMode(){if(renderer.xr.isPresenting)return ViewerMode.WEBXR;if(legacyCardboard||cardboard)return ViewerMode.CARDBOARD;return ViewerMode.DESKTOP}

const deviceOrientation=new DeviceOrientationControls(camera);deviceOrientation.enabled=false;
const cardboardDebug=new THREE.Group();cardboardDebug.visible=false;cardboardDebug.layers.enableAll();scene.add(cardboardDebug);
const xrDebug=new THREE.Group();xrDebug.visible=false;xrDebug.layers.set(0);xrDebug.position.set(0,1.6,-2.5);scene.add(xrDebug);
const xrDebugCube=new THREE.Mesh(new THREE.BoxGeometry(.5,.5,.5),new THREE.MeshBasicMaterial({color:0x39ff14,depthTest:false}));xrDebugCube.position.set(0,0,-2.2);xrDebugCube.renderOrder=1100;xrDebug.add(xrDebugCube);
{const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#001400';c.fillRect(0,0,512,128);c.strokeStyle='#39ff14';c.lineWidth=8;c.strokeRect(4,4,504,120);c.fillStyle='#fff';c.font='bold 40px monospace';c.textAlign='center';c.fillText('WEBXR TEST',256,80);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.position.set(0,-.65,-2.2);sp.scale.set(2.3,.58,1);sp.renderOrder=1101;xrDebug.add(sp)}
const debugCube=new THREE.Mesh(new THREE.BoxGeometry(.65,.65,.65),new THREE.MeshBasicMaterial({color:0xff2bd6,depthTest:false}));debugCube.position.set(0,0,-3);debugCube.renderOrder=1000;cardboardDebug.add(debugCube);
{const cv=document.createElement('canvas');cv.width=512;cv.height=128;const c=cv.getContext('2d');c.fillStyle='#001018';c.fillRect(0,0,512,128);c.strokeStyle='#00ffff';c.lineWidth=8;c.strokeRect(4,4,504,120);c.fillStyle='#fff';c.font='bold 42px monospace';c.textAlign='center';c.fillText('VR TEST',256,80);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.position.set(0,-.75,-3);sp.scale.set(2.2,.55,1);sp.renderOrder=1001;cardboardDebug.add(sp)}

function eyeTexture(source,eye){
 const t=source.clone();t.needsUpdate=true;t.colorSpace=THREE.SRGBColorSpace;
 if(stereoMode==='sbs'){t.repeat.set(.5,1);t.offset.set(eye==='left'?0:.5,0)}
 else if(stereoMode==='tb'){t.repeat.set(1,.5);t.offset.set(0,eye==='left'?.5:0)}
 return t;
}
function installSeamBlur(material,eye=null){
 if(projection!=='360')return;
 const strength=seamBlurAmount(effectSettings.seamBlurStrength);
 if(!strength)return;
 const bounds=stereoMode==='sbs'
  ?new THREE.Vector2(eye==='right'?.5:0,eye==='right'?1:.5)
  :new THREE.Vector2(0,1);
 const width=material.map?.image?.width||0;
 installPanoramaSeamShader(material,strength,bounds,width?0.5/width:0);
}
let parallaxDepthPixels=null;

let manualFoliageMaskImage=null;
let manualWaterMaskImage=null,waterMotionMask=null;
async function decodeSceneImage(url,blob,anonymous=false){
 const create=source=>{const img=new Image();if(anonymous)img.crossOrigin='anonymous';img.src=source;return img;};
 if(!blob){const img=create(url);await img.decode();return img;}
 const objectUrl=URL.createObjectURL(blob);
 try{
  const img=create(objectUrl);await img.decode();return img;
 }catch{
  const img=create(url);await img.decode();return img;
 }finally{URL.revokeObjectURL(objectUrl);}
}
async function fetchManualWaterMask(settings,preloadedBlob=null){
 if(!settings.parallaxWaterMotion||!settings.parallaxWaterMask)return null;
 try{return await decodeSceneImage(settings.parallaxWaterMask,preloadedBlob);}
 catch(e){console.warn('MiniVR water mask unavailable',e);return null;}
}
async function fetchManualFoliageMask(settings,preloadedBlob=null){
 if(!settings.parallaxFoliageMask)return null;
 try{return await decodeSceneImage(settings.parallaxFoliageMask,preloadedBlob);}
 catch(e){console.warn('MiniVR manual foliage mask unavailable',e);return null;}
}
async function fetchParallaxDepth(settings,projectionMode,stereo,preloadedBlob=null){
 if(projectionMode!=='360'||stereo!=='mono'||!settings.parallaxEnabled||!settings.parallaxDepth)return null;
 try{
  const img=await decodeSceneImage(settings.parallaxDepth,preloadedBlob,true);
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,256,128);
  return ctx.getImageData(0,0,256,128).data;
 }catch(e){console.warn('MiniVR depth map unavailable',e);return null;}
}
function sampleDepthBilinear(u,v){
 // Longitude wraps at the seam; latitude clamps at the poles.
 const x=((u%1)+1)%1*256-.5,y=Math.max(0,Math.min(127,(1-v)*128-.5));
 const x0=Math.floor(x),y0=Math.floor(y),fx=x-x0,fy=y-y0;
 const read=(ix,iy)=>parallaxDepthPixels[(Math.max(0,Math.min(127,iy))*256+((ix%256)+256)%256)*4]/255;
 const top=read(x0,y0)*(1-fx)+read(x0+1,y0)*fx;
 const bottom=read(x0,y0+1)*(1-fx)+read(x0+1,y0+1)*fx;
 return top*(1-fy)+bottom*fy;
}
// Optional near-field emphasis. Depth maps use 0=far and 1=near.
function remapParallaxDepth(depth){
 if(!effectSettings.parallaxNonlinear)return depth;
 const strength=THREE.MathUtils.clamp(Number(effectSettings.parallaxNonlinearStrength??50),0,100)/100;
 // Smoothly preserve distant geometry while expanding the near-field response.
 return THREE.MathUtils.lerp(depth,Math.pow(depth,2.2),strength);
}
// Relief is opt-in and only built for the desktop mono 360 viewer.
// The toggle reloads the scene, so old geometry is never mutated in place.
function desktopReliefEnabled(){
 if(projection!=='360'||stereoMode!=='mono'||!parallaxDepthPixels||!effectSettings.parallaxEnabled)return false;
 return getViewerMode()===ViewerMode.DESKTOP;
}
function applyDepthGeometry(g){
 if(!parallaxDepthPixels)return;
 const uv=g.getAttribute('uv'),pos=g.getAttribute('position');
 const strength=Math.max(0,Math.min(100,Number(effectSettings.parallaxStrength)||0))/100;
 if(strength<=0)return;
 // Depth-map values are relative, not metric distances. Map them to a bounded
 // inverse-depth shell: nearby pixels move more than distant pixels.
 const relief=desktopReliefEnabled();
 const near=relief?8:12,far=relief?58:46;
 const radii=new Float32Array(pos.count);
 for(let i=0;i<pos.count;i++){
  const u=uv.getX(i),v=uv.getY(i);
  let depth=sampleDepthBilinear(u,v);
  // Suppress noise at the poles where many triangles converge.
  const polarFade=Math.min(1,Math.max(0,Math.sin(Math.PI*v)*8));
  depth=.5+(depth-.5)*polarFade;
  depth=remapParallaxDepth(depth);
  const inverseDistance=(1/far)+(1/near-1/far)*depth;
  const mapped=1/inverseDistance;
  radii[i]=THREE.MathUtils.lerp(26,mapped,relief?Math.min(1,strength*1.55):strength);
 }
 // One mild mesh-space smoothing pass avoids jagged depth steps and cracks.
 const width=relief?385:257,height=relief?193:129;
 if(pos.count===width*height){
  const smooth=new Float32Array(radii);
  for(let y=1;y<height-1;y++)for(let x=0;x<width;x++){
   const i=y*width+x;
   const left=y*width+(x===0?width-2:x-1),right=y*width+(x===width-1?1:x+1);
   if(relief){
    // Bilateral radius smoothing: smooth texture noise, but do not pull a
    // foreground silhouette into the background across a depth jump.
    const center=radii[i],neighbors=[left,right,i-width,i+width];
    let total=center*4,weight=4;
    for(const n of neighbors){
     const difference=Math.abs(center-radii[n]);
     if(difference>1.6)continue;
     const w=Math.exp(-difference*difference/1.28);
     total+=radii[n]*w;weight+=w;
    }
    smooth[i]=total/weight;
   }else smooth[i]=radii[i]*.7+(radii[left]+radii[right]+radii[i-width]+radii[i+width])*.075;
  }
  radii.set(smooth);
  // The duplicated longitude seam must have exactly identical positions.
  for(let y=0;y<height;y++){const l=y*width,r=l+width-1;const avg=(radii[l]+radii[r])*.5;radii[l]=avg;radii[r]=avg;}
 }
 for(let i=0;i<pos.count;i++){
  const old=Math.hypot(pos.getX(i),pos.getY(i),pos.getZ(i))||500;
  const scale=radii[i]/old;
  pos.setXYZ(i,pos.getX(i)*scale,pos.getY(i)*scale,pos.getZ(i)*scale);
 }
 pos.needsUpdate=true;
 // Keep the reconstructed sphere continuous. Removing depth-edge triangles
 // creates visible holes and jagged strips around trees and foliage.
 g.computeVertexNormals();
 g.computeBoundingSphere();
}

function geometry(aspect=16/9){
 if(projection==='flat'){const h=2.7,w=h*aspect;return new THREE.PlaneGeometry(w,h)}
 if(projection==='180') return new THREE.SphereGeometry(500,64,40,0,Math.PI);
 const relief=desktopReliefEnabled();
 const g=new THREE.SphereGeometry(500,parallaxDepthPixels?(relief?384:256):64,parallaxDepthPixels?(relief?192:128):40);applyDepthGeometry(g);return g;
}
function sourceAspect(source){const im=source.image;if(!im?.width||!im?.height)return 16/9;let w=im.width,h=im.height;if(stereoMode==='sbs')w/=2;else if(stereoMode==='tb')h/=2;return w/h}
function makeEye(source,eye){
 const g=geometry(sourceAspect(source));if(effectSettings.mirrorHorizontal){const uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}const m=new THREE.MeshBasicMaterial({map:eyeTexture(source,eye),side:projection==='flat'?THREE.FrontSide:THREE.BackSide});
 installSeamBlur(m,eye);
 const mesh=new THREE.Mesh(g,m);
 if(projection==='flat'){mesh.position.set(3.2,0,0);mesh.rotation.y=-Math.PI/2;}
 else if(projection==='180')mesh.rotation.y=Math.PI/2;
 mesh.layers.set(eye==='left'?1:2);scene.add(mesh);return mesh;
}
// A lightweight, local depth-guided background approximation. This is not
// generative AI: unknown pixels are propagated from nearby visible background.
function makeDepthBackground(source){
 if(!parallaxDepthPixels||effectSettings.parallaxOcclusionFill===false)return null;
 const image=source.image;
 if(!image?.width||!image?.height)return null;
 try{
  const w=512,h=256,canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0,w,h);
  const frame=ctx.getImageData(0,0,w,h),pixels=frame.data;
  const original=new Uint8ClampedArray(pixels),mask=new Uint8Array(w*h);
  const relief=desktopReliefEnabled();
  // Foreground pixels are replaced by nearest known background colors.
  let count=0;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const depth=sampleDepthBilinear((x+.5)/w,1-(y+.5)/h);
   if(depth>(relief?.59:.64)){mask[y*w+x]=1;count++;}
  }
  if(!count||count>w*h*.75)return null;
  let known=new Uint8Array(w*h);
  for(let i=0;i<known.length;i++)known[i]=mask[i]?0:1;
  for(let pass=0;pass<(relief?64:48);pass++){
   const next=known.slice(),updates=[];
   for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    const i=y*w+x;if(known[i])continue;
    const neighbors=[y*w+(x+w-1)%w,y*w+(x+1)%w];
    if(y>0)neighbors.push(i-w);
    if(y<h-1)neighbors.push(i+w);
    let r=0,g=0,b=0,n=0;
    for(const j of neighbors)if(known[j]){r+=pixels[j*4];g+=pixels[j*4+1];b+=pixels[j*4+2];n++;}
    if(n){updates.push([i,r/n,g/n,b/n]);next[i]=1;}
   }
   if(!updates.length)break;
   for(const [i,r,g,b] of updates){pixels[i*4]=r;pixels[i*4+1]=g;pixels[i*4+2]=b;}
   known=next;
  }
  // Keep non-foreground pixels faithful to the original panorama.
  for(let i=0;i<mask.length;i++)if(!mask[i])pixels.set(original.subarray(i*4,i*4+4),i*4);
  ctx.putImageData(frame,0,0);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.wrapS=THREE.RepeatWrapping;
  const geo=new THREE.SphereGeometry(80,96,48);
  if(effectSettings.mirrorHorizontal){const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,depthWrite:false});
  installSeamBlur(material);
  const mesh=new THREE.Mesh(geo,material);
  mesh.layers.set(0);mesh.renderOrder=-10;
  return mesh;
 }catch(err){console.warn('Depth background fill unavailable',err);return null;}
}
let depthBackgroundMesh=null;
// Hybrid parallax: five overlapping depth bands on independent transparent
// meshes. Each mesh keeps continuous per-vertex depth (no flat cut-outs).
// Original 2:1 panorama and longitude seam are preserved.
let hybridMeshes=[];
function clearHybridMeshes(){
 microMotionMaterials.length=0;
 if(foliageWindMask){foliageWindMask.dispose();foliageWindMask=null;}
 if(waterMotionMask){waterMotionMask.dispose();waterMotionMask=null;}
 for(const mesh of hybridMeshes){scene.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();}
 hybridMeshes=[];
}
// Fast local foliage candidate mask: chromatic green dominance + local texture.
// It is a conservative browser-only heuristic, not semantic AI segmentation.
// Seasonal foliage candidate classifier: green, yellow-green, gold, orange,
// muted red and brown. Texture and local colour variation suppress flat walls.
// This is an inexpensive heuristic, NOT semantic foliage segmentation.
function foliageMaskForGeometry(geo,imagePixels,w,h){
 const uv=geo.getAttribute('uv'),out=new Float32Array(uv.count);
 const sample=(x,y)=>{
  x=((x%w)+w)%w;y=Math.max(0,Math.min(h-1,y));
  const i=(y*w+x)*4,r=imagePixels[i]/255,g=imagePixels[i+1]/255,b=imagePixels[i+2]/255;
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b),delta=hi-lo;
  if(hi<.12||hi>.94||delta<.075)return 0;
  // HSV hue in degrees, saturation and value.
  let hue=0;
  if(delta>0){
   if(hi===r)hue=60*(((g-b)/delta+6)%6);
   else if(hi===g)hue=60*((b-r)/delta+2);
   else hue=60*((r-g)/delta+4);
  }
  const saturation=delta/hi;
  // Warm red foliage excludes magenta and highly saturated artificial reds.
  const green=hue>=55&&hue<=165;
  const yellow=hue>=34&&hue<55;
  const orange=hue>=15&&hue<34;
  const red=(hue>=0&&hue<15)||(hue>=345&&hue<=360);
  const brown=hue>=10&&hue<=48&&hi<.60;
  const seasonal=green?1:yellow?.95:orange?.82:red?.62:brown?.56:0;
  return seasonal*Math.min(1,saturation*3)*(hi>.2?1:.5);
 };
 for(let i=0;i<uv.count;i++){
  const x=Math.floor((1-uv.getX(i))*w),y=Math.floor((1-uv.getY(i))*h);
  const dx=Math.max(1,Math.floor(w/512)),dy=Math.max(1,Math.floor(h/256));
  let sum=0,min=1,max=0,chromatic=0;
  for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){
   const v=sample(x+xx*dx,y+yy*dy);sum+=v;min=Math.min(min,v);max=Math.max(max,v);
   if(v>.12)chromatic++;
  }
  // Require both local fine-scale variation and a meaningful cluster of foliage colours.
  const textured=Math.min(1,(max-min)*4.5);
  const density=Math.min(1,chromatic/12);
  out[i]=Math.min(1,sum/25)*textured*density;
 }
 geo.setAttribute('foliageWeight',new THREE.Float32BufferAttribute(out,1));
}
// Per-pixel wind distortion: unlike vertex motion, this is visible even when
// foliage occupies only a few pixels inside a large sphere triangle.
const microMotionMaterials=[];
let foliageWindMask=null;
function makeFoliageWindMask(original,w,h){
 const mw=Math.min(512,w),mh=Math.min(256,h);
 const mask=document.createElement('canvas');mask.width=mw;mask.height=mh;
 const ctx=mask.getContext('2d'),frame=ctx.createImageData(mw,mh);
 const colour=(x,y)=>{
  x=Math.max(0,Math.min(w-1,x));y=Math.max(0,Math.min(h-1,y));
  const i=(y*w+x)*4,r=original[i]/255,g=original[i+1]/255,b=original[i+2]/255;
  const hi=Math.max(r,g,b),lo=Math.min(r,g,b),d=hi-lo;
  if(hi<.12||hi>.96||d<.07)return 0;
  let hue=0;
  if(hi===r)hue=60*(((g-b)/d+6)%6);
  else if(hi===g)hue=60*((b-r)/d+2);
  else hue=60*((r-g)/d+4);
  const seasonal=(hue>=35&&hue<=165)?1:(hue>=12&&hue<35)?.75:(hue<12||hue>345)?.55:0;
  return seasonal*Math.min(1,d/hi*3);
 };
 for(let y=0;y<mh;y++)for(let x=0;x<mw;x++){
  const sx=Math.floor((x+.5)*w/mw),sy=Math.floor((y+.5)*h/mh);
  const step=Math.max(1,Math.floor(w/mw/2));
  let sum=0,min=1,max=0;
  for(let yy=-2;yy<=2;yy++)for(let xx=-2;xx<=2;xx++){
   const v=colour(sx+xx*step,sy+yy*step);sum+=v;min=Math.min(min,v);max=Math.max(max,v);
  }
  const weight=Math.min(1,sum/25)*Math.min(1,(max-min)*5);
  const i=(y*mw+x)*4;
  frame.data[i]=frame.data[i+1]=frame.data[i+2]=Math.round(weight*255);
  frame.data[i+3]=255;
 }
 ctx.putImageData(frame,0,0);
 const texture=new THREE.CanvasTexture(mask);
 texture.wrapS=THREE.RepeatWrapping;texture.minFilter=THREE.LinearFilter;
 return texture;
}
function installMicroMotion(material,band,count){
 if(effectSettings.parallaxMicroMotion===false||new URLSearchParams(location.search).get('micro_motion')==='0')return;
 // Never animate every depth layer: restrict wind to the two foreground bands.
 if(!foliageWindMask)return;
 // Manual mask already defines exactly what moves; do not restrict it to depth bands.
 if(!manualFoliageMaskImage&&band<count-2)return;
 const preview=new URLSearchParams(location.search);
 const boosted=preview.get('micro_motion_preview')==='1';
 const showMask=preview.get('micro_motion_mask')==='1';
 const phase={value:0},strength={value:boosted?1:THREE.MathUtils.clamp(Number(effectSettings.parallaxMicroMotionStrength??60),0,100)/100};
 const speed=THREE.MathUtils.clamp(Number(effectSettings.parallaxMicroMotionSpeed??1),.1,5);
 // Motion is strongest in the nearest depth band; distant foliage stays calmer.
 const depthWeight=manualFoliageMaskImage?1:THREE.MathUtils.lerp(.38,1,band/Math.max(1,count-1));
 material.onBeforeCompile=shader=>{
  shader.uniforms.microMotionTime=phase;
  shader.uniforms.microMotionStrength=strength;
  shader.uniforms.foliageWindMask={value:foliageWindMask};
  shader.fragmentShader='uniform float microMotionTime;\nuniform float microMotionStrength;\nuniform sampler2D foliageWindMask;\n'+shader.fragmentShader;
  shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`
#ifdef USE_MAP
  vec2 windUv = vMapUv;
  float windMask = texture2D(foliageWindMask,windUv).${manualFoliageMaskImage?'a':'r'};
  windMask = smoothstep(0.025, 0.32, windMask);
  float phaseA = microMotionTime*1.3 + windUv.y*34.0 + sin(windUv.x*38.0);
  float phaseB = microMotionTime*.8 + windUv.x*51.0;
  vec2 windShift = vec2(sin(phaseA)*.006 + sin(phaseB)*.002,cos(phaseB)*.003);
  float gust = 0.72 + 0.18*sin(microMotionTime*0.31 + windUv.x*12.0)
                     + 0.10*sin(microMotionTime*0.17 - windUv.y*9.0);
  windUv += windShift*windMask*microMotionStrength*${depthWeight.toFixed(4)}*gust;
  vec4 sampledDiffuseColor = texture2D(map,windUv);
  diffuseColor *= sampledDiffuseColor;
  ${showMask ? 'diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.1, 0.75), windMask * 0.8);' : ''}
#endif
  `);
 };
 material.customProgramCacheKey=()=> 'minivr-foliage-fragment-wind-v6-'+(boosted?'preview':'normal')+(showMask?'-mask':'');
 microMotionMaterials.push({material,phase,speed});
}
function installWaterMotion(material){
 if(!waterMotionMask||new URLSearchParams(location.search).get('water_motion')==='0')return;
 const phase={value:0},strength={value:THREE.MathUtils.clamp(Number(effectSettings.parallaxWaterStrength??45),0,100)/100};
 const speed=THREE.MathUtils.clamp(Number(effectSettings.parallaxWaterSpeed??1),.1,5);
 const kind=({calm:0,sea:1,surf:5,river:2,waterfall:3,underwater:4})[effectSettings.parallaxWaterType]??0;
 const direction=THREE.MathUtils.degToRad(Number(effectSettings.parallaxWaterDirection)||0);
 const previous=material.onBeforeCompile;
 material.onBeforeCompile=shader=>{
  if(previous)previous(shader);
  shader.uniforms.waterMotionTime=phase;
  shader.uniforms.waterMotionStrength=strength;
  shader.uniforms.waterMotionMask={value:waterMotionMask};
  shader.fragmentShader='uniform float waterMotionTime;\nuniform float waterMotionStrength;\nuniform sampler2D waterMotionMask;\n'+shader.fragmentShader;
  // Water is composed with foliage inside the same map sample when both effects are active.
  const waterCode=`
  float waterCoverage = smoothstep(0.02,0.28,texture2D(waterMotionMask,vMapUv).a);
  float wt = waterMotionTime;
  float waves = sin(vMapUv.y * ${kind===1?'120.0':'75.0'} + wt * ${kind===1?'3.4':'1.8'} + sin(vMapUv.x*35.0+wt)*0.7);
  float ripples = sin(vMapUv.x*165.0+wt*2.1)*cos(vMapUv.y*145.0-wt*1.4);
  vec2 flowDirection = vec2(cos(${direction.toFixed(6)}),sin(${direction.toFixed(6)}));
  vec2 waterShift = vec2(waves*0.0025+ripples*0.0008,ripples*0.0013);
  ${kind===1?'waterShift += vec2(sin(vMapUv.y*52.0+wt*2.5)*0.003,cos(vMapUv.x*30.0-wt)*0.001);':''}
  ${kind===5?`
  // Shore break: advancing, staggered wave fronts rather than global jitter.
  // The selected mask protects the sky, shoreline and all non-water pixels.
  float shoreY=clamp(vMapUv.y,0.0,1.0);
  float surfNear=smoothstep(0.18,0.78,1.0-shoreY);
  float phaseA=(shoreY*21.0-wt*1.18)+sin(vMapUv.x*12.0+wt*.17)*.24;
  float phaseB=(shoreY*35.0-wt*1.67)+sin(vMapUv.x*17.0-wt*.11)*.17;
  float crestA=pow(max(0.0,cos(phaseA)),12.0);
  float crestB=pow(max(0.0,cos(phaseB+1.7)),16.0);
  float forward=(.0018+.0024*surfNear)*(crestA*.85+crestB*.35);
  float backwash=sin(phaseA-1.0)*(.0005+.0007*surfNear);
  float foamDrift=sin(vMapUv.x*78.0+phaseB*1.3)*crestA*.0007;
  waterShift=vec2(foamDrift+sin(phaseA)*.00055,forward+backwash);
  waterShift+=flowDirection*(.0015+.0012*surfNear)*(crestA+crestB*.4);
  `:''}

  ${kind===2?'waterShift += flowDirection * (0.003*sin(wt*1.8+vMapUv.y*100.0));':''}
  ${kind===3?'waterShift += vec2(ripples*0.001,0.005*sin(wt*2.5+vMapUv.y*90.0));':''}
  ${kind===4?'waterShift *= 0.45;':''}
  waterShift *= waterCoverage * waterMotionStrength * (0.88 + 0.12*sin(wt*0.23 + vMapUv.x*17.0));
  `;
  // Inject before the foliage map sample when present; otherwise replace standard map chunk.
  if(shader.fragmentShader.includes('vec4 sampledDiffuseColor = texture2D(map,windUv);')){
   shader.fragmentShader=shader.fragmentShader.replace('vec4 sampledDiffuseColor = texture2D(map,windUv);',waterCode+'\n  windUv += waterShift;\n  vec4 sampledDiffuseColor = texture2D(map,windUv);');
  }else{
   shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',`#ifdef USE_MAP
   vec2 waterUv=vMapUv;
   ${waterCode}
   waterUv+=waterShift;
   diffuseColor*=texture2D(map,waterUv);
   #endif`);
  }
 };
 const prevKey=material.customProgramCacheKey?.bind(material);
 material.customProgramCacheKey=()=> (prevKey?prevKey():'minivr-water')+'-water-v2-'+kind+'-'+direction.toFixed(4);
 microMotionMaterials.push({material,phase,speed});
}
// Parallax quality is independent of the original 360° texture resolution.
// Auto uses a conservative mobile budget; Cardboard is more demanding (two eyes).
const parallaxQualityKey='minivr-parallax-quality';
const parallaxQualityOptions=['auto','high','medium','low'];
let parallaxQuality='auto';
try {
 const saved=localStorage.getItem(parallaxQualityKey);
 if(parallaxQualityOptions.includes(saved))parallaxQuality=saved;
} catch {}
function parallaxQualityBudget(){
 const mobile=/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints>1 && window.innerWidth<1100);
 const memory=Number(navigator.deviceMemory)||0;
 const mode=typeof getViewerMode==='function'?getViewerMode():'desktop';
 const isCardboard=mode==='cardboard';
 const auto=isCardboard||mobile&&memory>0&&memory<=4?'low':mobile?'medium':'high';
 const quality=parallaxQuality==='auto'?auto:parallaxQuality;
 const budgets={high:{width:4096,layers:5},medium:{width:2048,layers:3},low:{width:1024,layers:2}};
 return budgets[quality];
}
function installParallaxQualityControl(){
 const select=document.createElement('select');
 select.id='minivr-parallax-quality';
 select.setAttribute('aria-label','Качество параллакса');
 select.title='Качество слоёв параллакса (после смены страница перезагрузится)';
 select.style.cssText='position:fixed;right:12px;bottom:12px;z-index:10002;background:#071824;color:#fff;border:1px solid #43849d;border-radius:8px;padding:7px;font:13px sans-serif;max-width:170px';
 for(const [value,label] of [['auto','Параллакс: авто'],['high','Параллакс: высокое'],['medium','Параллакс: среднее'],['low','Параллакс: низкое']]){
  const option=document.createElement('option');option.value=value;option.textContent=label;select.appendChild(option);
 }
 select.value=parallaxQuality;
 select.addEventListener('change',()=>{
  parallaxQuality=select.value;
  try{localStorage.setItem(parallaxQualityKey,parallaxQuality)}catch{}
  window.location.reload();
 });
 document.body.appendChild(select);
}
installParallaxQualityControl();
// Experimental depth-surface reconstruction is opt-in until it has been
// checked against thin foliage, railings and other difficult silhouettes.
const experimentalDepthSurfaces=false; // Disabled after visual artifacts.
function shapeDepthBandSurface(geo,band,count){
 const position=geo.getAttribute('position'),uv=geo.getAttribute('uv');
 const center=(band+.5)/count;
 // Map each band to a separate inverse-depth surface, retaining some local
 // depth variation. Keep all triangles connected: removing them created holes.
 const near=8,far=58;
 const bandRadius=1/((1/far)+(1/near-1/far)*center);
 for(let i=0;i<position.count;i++){
  const d=remapParallaxDepth(sampleDepthBilinear(uv.getX(i),uv.getY(i)));
  const local=Math.max(-.5/count,Math.min(.5/count,d-center));
  const targetDepth=Math.max(0,Math.min(1,center+local*.35));
  const targetRadius=1/((1/far)+(1/near-1/far)*targetDepth);
  const radius=Math.hypot(position.getX(i),position.getY(i),position.getZ(i))||1;
  const newRadius=THREE.MathUtils.lerp(radius,targetRadius,.65);
  const scale=newRadius/radius;
  position.setXYZ(i,position.getX(i)*scale,position.getY(i)*scale,position.getZ(i)*scale);
 }
 position.needsUpdate=true;
 geo.computeVertexNormals();
 geo.computeBoundingSphere();
}
function makeHybridDepthGroups(source){
 const budget=parallaxQualityBudget();
 const count=Math.max(2,Math.min(budget.layers,Number(effectSettings.parallaxGroups)||5));
 const image=source.image;if(!image?.width||!image?.height)return false;
 const maxTextureSize=renderer.capabilities.maxTextureSize||4096;
 const sourceWidth=image.naturalWidth||image.videoWidth||image.width,sourceHeight=image.naturalHeight||image.videoHeight||image.height;
 const scale=Math.min(1,maxTextureSize/sourceWidth,maxTextureSize/sourceHeight,budget.width/sourceWidth);
 const w=Math.max(2,Math.round(sourceWidth*scale/2)*2),h=Math.max(1,Math.round(sourceHeight*scale));
 const base=document.createElement('canvas');base.width=w;base.height=h;
 const baseCtx=base.getContext('2d',{willReadFrequently:true});baseCtx.drawImage(image,0,0,w,h);
 const original=baseCtx.getImageData(0,0,w,h).data;
 foliageWindMask=null;
 if(effectSettings.parallaxMicroMotion!==false){
  if(manualFoliageMaskImage){const maskCanvas=document.createElement('canvas');maskCanvas.width=512;maskCanvas.height=256;const maskCtx=maskCanvas.getContext('2d');maskCtx.drawImage(manualFoliageMaskImage,0,0,512,256);foliageWindMask=new THREE.CanvasTexture(maskCanvas);foliageWindMask.wrapS=THREE.RepeatWrapping;foliageWindMask.minFilter=THREE.LinearFilter;}
  else foliageWindMask=makeFoliageWindMask(original,w,h);
 }
 waterMotionMask=null;
 if(manualWaterMaskImage){const maskCanvas=document.createElement('canvas');maskCanvas.width=512;maskCanvas.height=256;maskCanvas.getContext('2d').drawImage(manualWaterMaskImage,0,0,512,256);waterMotionMask=new THREE.CanvasTexture(maskCanvas);waterMotionMask.wrapS=THREE.RepeatWrapping;waterMotionMask.minFilter=THREE.LinearFilter;}
 const depth=new Float32Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)depth[y*w+x]=remapParallaxDepth(sampleDepthBilinear((x+.5)/w,1-(y+.5)/h));
 // Soft screen-space depth-edge shadows. Computed only when explicitly enabled.
 // This is a depth-derived approximation, not physically traced cast shadows.
 const contactStrength=effectSettings.parallaxContactShadows===true
  ?THREE.MathUtils.clamp(Number(effectSettings.parallaxContactShadowStrength??40),0,100)/100:0;
 const contactShadow=contactStrength>0?new Float32Array(w*h):null;
 if(contactShadow){
  const radius=Math.max(1,Math.round(w/1024*3));
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const i=y*w+x,d=depth[i];let edge=0;
   for(const [dx,dy] of [[-radius,0],[radius,0],[0,-radius],[0,radius],[-radius,-radius],[radius,radius]]){
    const nx=(x+dx+w)%w,ny=Math.max(0,Math.min(h-1,y+dy));
    const difference=depth[ny*w+nx]-d;
    if(difference>.06)edge=Math.max(edge,Math.min(1,(difference-.06)*3.5));
   }
   contactShadow[i]=edge;
  }
 }

 for(let band=0;band<count;band++){
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d'),frame=ctx.createImageData(w,h),pixels=frame.data;
  const center=(band+.5)/count,halfWidth=1/count;
  const occlusion=effectSettings.parallaxDynamicOcclusion===true||desktopReliefEnabled()
   ?Math.max(desktopReliefEnabled()?.55:0,THREE.MathUtils.clamp(Number(effectSettings.parallaxOcclusionStrength??50),0,100)/100):0;
  for(let i=0;i<depth.length;i++){
   const distance=Math.abs(depth[i]-center);
   const weight=Math.max(0,Math.min(1,(halfWidth-distance)/(.5/count)));
   if(weight<=0)continue;
   // Sharper coverage on near bands gives them a more definite silhouette,
   // while retaining a feathered transition at depth boundaries.
   const foreground=band/(count-1);
   const edgePower=1+occlusion*foreground*2.2;
   const coverage=occlusion>0?Math.pow(weight,edgePower):weight;
   const j=i*4;
   // Darken only the deeper receiving bands near a nearer depth boundary.
   // Preserve source colors when the feature is disabled.
   const shadow=contactShadow&&depth[i]<center+.5/count
    ?contactShadow[i]*contactStrength*.48:0;
   const light=1-shadow;
   pixels[j]=Math.round(original[j]*light);
   pixels[j+1]=Math.round(original[j+1]*light);
   pixels[j+2]=Math.round(original[j+2]*light);
   pixels[j+3]=Math.round(255*coverage);
  }
  ctx.putImageData(frame,0,0);
  const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
  const geo=geometry();
  if(experimentalDepthSurfaces&&desktopReliefEnabled())shapeDepthBandSurface(geo,band,count);
  if(occlusion>0){
   // Shift each band to a progressively closer shell. Foreground silhouettes
   // occlude more of the distant bands during existing camera parallax.
   const pos=geo.getAttribute('position');
   const nearBias=occlusion*(band/(count-1))*1.8;
   for(let k=0;k<pos.count;k++){
    const x=pos.getX(k),y=pos.getY(k),z=pos.getZ(k);
    const radius=Math.hypot(x,y,z)||1;
    const factor=Math.max(.85,(radius-nearBias)/radius);
    pos.setXYZ(k,x*factor,y*factor,z*factor);
   }
   pos.needsUpdate=true;geo.computeBoundingSphere();
  }
  
  if(effectSettings.mirrorHorizontal){const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.BackSide,transparent:true,depthWrite:false,alphaTest:desktopReliefEnabled()?.055:.015});
  installMicroMotion(material,band,count);
  installWaterMotion(material);
  installSeamBlur(material);
  const mesh=new THREE.Mesh(geo,material);mesh.layers.set(0);mesh.renderOrder=band;
  scene.add(mesh);hybridMeshes.push(mesh);
 }
 return true;
}
function installPanorama(source){
 source.colorSpace=THREE.SRGBColorSpace;
 const previous=[...new Set([leftMesh,rightMesh].filter(Boolean))];
 clearHybridMeshes();
 if(depthBackgroundMesh){scene.remove(depthBackgroundMesh);depthBackgroundMesh.geometry.dispose();depthBackgroundMesh.material.map?.dispose();depthBackgroundMesh.material.dispose();depthBackgroundMesh=null;}
 if(projection==='360'&&stereoMode==='mono'&&parallaxDepthPixels ){depthBackgroundMesh=makeDepthBackground(source);if(depthBackgroundMesh)scene.add(depthBackgroundMesh);}
 if(stereoMode==='mono'){
  const hybrid=projection==='360'&&parallaxDepthPixels&&effectSettings.parallaxEnabled&&(effectSettings.parallaxMode==='hybrid'||desktopReliefEnabled())&&makeHybridDepthGroups(source);
  if(hybrid){
   // Keep the original at the far radius to cover disocclusions between bands.
   const geo=new THREE.SphereGeometry(80,96,48);
   if(effectSettings.mirrorHorizontal){const uv=geo.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}
   const backdropMaterial=new THREE.MeshBasicMaterial({map:source,side:THREE.BackSide,depthWrite:false});
   installSeamBlur(backdropMaterial);
   const backdrop=new THREE.Mesh(geo,backdropMaterial);
   backdrop.layers.set(0);backdrop.renderOrder=-20;scene.add(backdrop);leftMesh=rightMesh=backdrop;
  }else{
  const g=geometry(sourceAspect(source));if(effectSettings.mirrorHorizontal){const uv=g.getAttribute('uv');for(let i=0;i<uv.count;i++)uv.setX(i,1-uv.getX(i));uv.needsUpdate=true;}
  const material=new THREE.MeshBasicMaterial({map:source,side:projection==='flat'?THREE.FrontSide:THREE.BackSide});
  installSeamBlur(material);
  const mesh=new THREE.Mesh(g,material);
  if(projection==='flat'){mesh.position.set(3.2,0,0);mesh.rotation.y=-Math.PI/2;}else if(projection==='180')mesh.rotation.y=Math.PI/2;
  mesh.layers.set(0);scene.add(mesh);leftMesh=rightMesh=mesh;
  }
 }else{leftMesh=makeEye(source,'left');rightMesh=makeEye(source,'right');source.dispose()}
 for(const mesh of previous){scene.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose()}
 if(getViewerMode()===ViewerMode.DESKTOP){if(stereoMode==='mono')camera.layers.set(0);else desktopEye()}
 requestAnimationFrame(()=>requestAnimationFrame(()=>document.body.classList.remove('scene-loading')));
}
function clearPanoramaMeshes(){
 clearHybridMeshes();
 if(depthBackgroundMesh){scene.remove(depthBackgroundMesh);depthBackgroundMesh.geometry.dispose();depthBackgroundMesh.material.map?.dispose();depthBackgroundMesh.material.dispose();depthBackgroundMesh=null;}
 for(const mesh of new Set([leftMesh,rightMesh].filter(Boolean))){scene.remove(mesh);mesh.geometry.dispose();mesh.material.map?.dispose();mesh.material.dispose();}
 leftMesh=rightMesh=null;
}
let tiledPanorama=null,panoramaLoadEpoch=0;
function tiledFoliageConfig(settings,manualMask){
 const query=new URLSearchParams(location.search);
 return {
  enabled:settings.parallaxMicroMotion!==false&&query.get('micro_motion')!=='0',
  manualMask,strength:settings.parallaxMicroMotionStrength??60,
  speed:settings.parallaxMicroMotionSpeed??1,
  preview:query.get('micro_motion_preview')==='1',showMask:query.get('micro_motion_mask')==='1'
 };
}
function tiledDepthConfig(settings,pixels){
 if(!pixels||!canUseTiledDepth(settings))return null;
 const relief=getViewerMode()===ViewerMode.DESKTOP;
 const hybrid=relief||settings.parallaxMode==='hybrid';
 const budget=parallaxQualityBudget();
 const bands=hybrid?Math.max(2,Math.min(budget.layers,Number(settings.parallaxGroups)||5)):0;
 const occlusion=settings.parallaxDynamicOcclusion===true||relief
  ?Math.max(relief?.55:0,THREE.MathUtils.clamp(Number(settings.parallaxOcclusionStrength??50),0,100)/100):0;
 return {
  pixels,field:makeDepthRadiusField(pixels,settings,relief),relief,bands,occlusion,
  nonlinear:settings.parallaxNonlinear===true?THREE.MathUtils.clamp(Number(settings.parallaxNonlinearStrength??50),0,100)/100:0
 };
}
async function loadInitialPanorama(){
 const epoch=panoramaLoadEpoch;
 const [depthPixels,foliageMask,waterMask]=await Promise.all([
  fetchParallaxDepth(effectSettings,projection,stereoMode),
  fetchManualFoliageMask(effectSettings),fetchManualWaterMask(effectSettings)
 ]);
 if(epoch!==panoramaLoadEpoch)return;
 parallaxDepthPixels=depthPixels;manualFoliageMaskImage=foliageMask;manualWaterMaskImage=waterMask;
 requestAnimationFrame(syncMobileMotionButton);
 if(projection==='360'&&stereoMode==='mono'&&root.dataset.tiles&&(!parallaxDepthPixels||canUseTiledDepth(effectSettings))){
  try{
   const tiles=await createTiledPanorama({url:root.dataset.tiles,scene,camera,renderer,mirror:!!effectSettings.mirrorHorizontal,
    depth:tiledDepthConfig(effectSettings,parallaxDepthPixels),foliage:tiledFoliageConfig(effectSettings,manualFoliageMaskImage),
    seamBlur:seamBlurAmount(effectSettings.seamBlurStrength)});
   if(epoch!==panoramaLoadEpoch){tiles.dispose();return;}
   tiledPanorama=tiles;
   document.body.classList.remove('scene-loading');queueNeighborPreload();return;
  }catch(err){console.warn('Tile mode unavailable; falling back to original image',err)}
 }
 new THREE.TextureLoader().load(root.dataset.image,texture=>{if(epoch!==panoramaLoadEpoch){texture.dispose();return;}installPanorama(texture);queueNeighborPreload()},undefined,err=>{if(epoch!==panoramaLoadEpoch)return;console.error('Scene texture load failed',err);document.querySelector('#loader span').textContent='SCENE LOAD ERROR';});
}
loadInitialPanorama();

function desktopEye(){camera.layers.enable(0);camera.layers.enable(1);camera.layers.disable(2)}
if(stereoMode==='mono'){camera.layers.set(0)}else desktopEye();
const hud=new THREE.Group(),interactive=[];scene.add(camera);scene.add(hud);hud.layers.enableAll();
function roundedRectShape(w,h,r){const s=new THREE.Shape();s.moveTo(r,0);s.lineTo(w-r,0);s.quadraticCurveTo(w,0,w,r);s.lineTo(w,h-r);s.quadraticCurveTo(w,h,w-r,h);s.lineTo(r,h);s.quadraticCurveTo(0,h,0,h-r);s.lineTo(0,r);s.quadraticCurveTo(0,0,r,0);return s}
const panelW=2.6,panelH=.42,panelGeo=new THREE.ShapeGeometry(roundedRectShape(panelW,panelH,.08));panelGeo.translate(-panelW/2,-panelH/2,0);
const panel=new THREE.Mesh(panelGeo,new THREE.MeshBasicMaterial({color:0x1a1a1a,opacity:0,transparent:true,side:THREE.DoubleSide,depthTest:false}));panel.position.set(0,0,-1.5);panel.renderOrder=100;hud.add(panel);
const panelBorderGeo=new THREE.ShapeGeometry(roundedRectShape(panelW+.02,panelH+.02,.09));panelBorderGeo.translate(-(panelW+.02)/2,-(panelH+.02)/2,0);const panelBorder=new THREE.Mesh(panelBorderGeo,new THREE.MeshBasicMaterial({color:0xffffff,opacity:0,transparent:true,side:THREE.DoubleSide,depthTest:false}));panelBorder.position.z=-.001;panel.add(panelBorder);
function hudButton(label,x,type,action,base=0x2a2a2a,hover=0x444444){const g=new THREE.Group(),m=new THREE.Mesh(new THREE.CircleGeometry(.08,32),new THREE.MeshBasicMaterial({color:base,opacity:.9,transparent:true,depthTest:false}));m.userData={interactive:true,type,action,baseColor:base,hoverColor:hover};g.add(m);const ring=new THREE.Mesh(new THREE.RingGeometry(.078,.082,32),new THREE.MeshBasicMaterial({color:0xffffff,opacity:.15,transparent:true,depthTest:false}));ring.position.z=.001;g.add(ring);const cv=document.createElement('canvas');cv.width=cv.height=64;const c=cv.getContext('2d');c.fillStyle='#fff';c.font='40px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(label,32,32);const lm=new THREE.Mesh(new THREE.PlaneGeometry(.1,.1),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));lm.position.z=.002;g.add(lm);g.position.set(x,0,.01);g.renderOrder=125;panel.add(g);interactive.push(m);return g}
function goScene(i){const s=tourData.scenes[i];if(s)navigate('/viewer.php?id='+s.panorama_id+'&tour='+tour+'&scene='+s.id+(immersiveLaunch?'&immersive=1':''))}
async function exitViewer(){if(renderer.xr.isPresenting){const session=renderer.xr.getSession();if(session)await session.end()}if(legacyCardboard&&legacyVRDisplay){try{await legacyVREffect.exitPresent()}catch{}}if(embedToken){location.href='/embed.php?token='+encodeURIComponent(embedToken);return}navigate(backUrl)}
const menuGroup=new THREE.Group(),infoGroup=new THREE.Group(),contentGroup=new THREE.Group();hud.add(menuGroup,infoGroup,contentGroup);menuGroup.visible=infoGroup.visible=contentGroup.visible=false;
function closePanels(except=null){if(except!==menuGroup)menuGroup.visible=false;if(except!==infoGroup)infoGroup.visible=false;if(except!==contentGroup){contentGroup.visible=false;clearGroup(contentGroup)}menuOpen=menuGroup.visible}
let menuOpen=false,menuPage=Math.max(0,Math.floor(Math.max(0,tourData.current)/6));
hudButton('✕',-.72,'exit-vr',()=>exitViewer(),0x2a2a2a,0xff3366);hudButton('⊞',-.48,'gallery',()=>{const show=!menuGroup.visible;closePanels(show?menuGroup:null);menuGroup.visible=show;menuOpen=show;if(show)buildMenu()});hudButton('⏮',-.24,'previous',()=>goScene(tourData.current-1));hudButton('⏭',0,'next',()=>goScene(tourData.current+1));hudButton('⟲',.24,'reset-orientation',()=>{lon=0;lat=0});hudButton('i',.48,'info',()=>{const show=!infoGroup.visible;closePanels(show?infoGroup:null);infoGroup.visible=show});hudButton('⌂',.72,'home',()=>navigate('/'));
{const cv=document.createElement('canvas');cv.width=900;cv.height=420;const c=cv.getContext('2d');c.fillStyle='#041923f2';c.fillRect(0,0,900,420);c.strokeStyle='#55e9f8';c.lineWidth=5;c.strokeRect(4,4,892,412);c.fillStyle='#70efff';c.font='bold 25px monospace';c.fillText('SCENE INFO',40,55);c.fillStyle='#fff';c.font='bold 42px sans-serif';c.fillText((tourData.title||'').slice(0,34),40,115);c.font='25px sans-serif';const words=(tourData.description||'Нет описания').split(' ');let line='',y=170;for(const w of words){const test=line+w+' ';if(c.measureText(test).width>800){c.fillText(line,40,y);line=w+' ';y+=38}else line=test;if(y>370)break}c.fillText(line,40,y);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(4.2,1.96,1);sp.position.set(0,.25,-3);sp.renderOrder=120;infoGroup.add(sp)}
function clearGroup(g){
 for(const object of [...g.children]){
  g.remove(object);
  object.traverse(node=>{
   const k=interactive.indexOf(node);if(k>=0)interactive.splice(k,1);
   node.geometry?.dispose?.();
   if(node.material){for(const material of Array.isArray(node.material)?node.material:[node.material]){
    material.map?.dispose?.();material.dispose();
   }}
  });
 }
 if(g===contentGroup)g.userData.stereoPictures=null;
}
let menuBuildId=0;
function sceneCard(s,index,x,y,buildId){const cv=document.createElement('canvas');cv.width=640;cv.height=360;const c=cv.getContext('2d');c.fillStyle=index===tourData.current?'#0c5865':'#061923';c.fillRect(0,0,640,360);c.strokeStyle=index===tourData.current?'#91f8ff':'#2f8a99';c.lineWidth=index===tourData.current?8:4;c.strokeRect(4,4,632,352);c.fillStyle='#6cefff';c.font='bold 22px monospace';c.fillText('SCENE '+String(index+1).padStart(2,'0'),26,42);c.fillStyle='#efffff';c.font='bold 31px sans-serif';let title=(s.title||'Сцена');if(title.length>28)title=title.slice(0,27)+'…';c.fillText(title,26,295);c.fillStyle='#6e929d';c.font='20px monospace';c.fillText(index===tourData.current?'CURRENT':'OPEN →',26,330);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(1.82,1.02,1);sp.position.set(x,y,-3.2);sp.userData.action=()=>goScene(index);sp.renderOrder=120;menuGroup.add(sp);interactive.push(sp);if(s.preview||s.image){new THREE.TextureLoader().load(s.preview||s.image,t=>{if(buildId!==menuBuildId){t.dispose();return}t.colorSpace=THREE.SRGBColorSpace;const pic=new THREE.Sprite(new THREE.SpriteMaterial({map:t,transparent:true,depthTest:false}));pic.scale.set(1.65,.62,1);pic.position.set(x,y+.13,-3.18);pic.renderOrder=121;pic.userData.action=()=>goScene(index);menuGroup.add(pic);interactive.push(pic)})}}
function galleryButton(label,x,y,action,type='gallery-control'){const g=new THREE.Group(),m=new THREE.Mesh(new THREE.CircleGeometry(.12,32),new THREE.MeshBasicMaterial({color:0x2a2a2a,opacity:.92,transparent:true,depthTest:false}));m.userData={interactive:true,type,action,baseColor:0x2a2a2a,hoverColor:0x444444};g.add(m);const ring=new THREE.Mesh(new THREE.RingGeometry(.116,.123,32),new THREE.MeshBasicMaterial({color:0xffffff,opacity:.15,transparent:true,depthTest:false}));ring.position.z=.001;g.add(ring);const cv=document.createElement('canvas');cv.width=cv.height=64;const c=cv.getContext('2d');c.fillStyle='#fff';c.font='36px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(label,32,32);const lm=new THREE.Mesh(new THREE.PlaneGeometry(.14,.14),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));lm.position.z=.002;g.add(lm);g.position.set(x,y,-3.12);g.renderOrder=126;menuGroup.add(g);interactive.push(m);return g}
function buildMenu(){const buildId=++menuBuildId;clearGroup(menuGroup);const pages=Math.max(1,Math.ceil(tourData.scenes.length/6));menuPage=Math.max(0,Math.min(menuPage,pages-1));const start=menuPage*6;tourData.scenes.slice(start,start+6).forEach((s,k)=>sceneCard(s,start+k,(k%3-1)*1.95,1.05-Math.floor(k/3)*1.15,buildId));galleryButton('‹',-1.55,-1.28,()=>{if(menuPage>0){menuPage--;buildMenu()}},'gallery-prev');galleryButton('›',1.55,-1.28,()=>{if(menuPage<pages-1){menuPage++;buildMenu()}},'gallery-next');galleryButton('✕',0,-1.68,()=>{menuGroup.visible=false;menuOpen=false},'gallery-close')}
buildMenu();hud.visible=false;
const hotspotObjects=[],hotspotVisuals=[];let activeHotspot=null,hoveredPortal=null;
function markerTexture(h,active=false){const cv=document.createElement('canvas');cv.width=512;cv.height=512;const c=cv.getContext('2d');c.clearRect(0,0,512,512);if(h.type==='scene'){const glow=c.createRadialGradient(256,256,40,256,256,205);glow.addColorStop(0,active?'#6fffff88':'#35eaff55');glow.addColorStop(.52,'#083c4c88');glow.addColorStop(.7,'#07141c33');glow.addColorStop(1,'#0000');c.fillStyle=glow;c.fillRect(0,0,512,512);for(let i=0;i<3;i++){c.beginPath();c.ellipse(256,256,118+i*22,184+i*9,0,0,Math.PI*2);c.lineWidth=active?12-i*2:8-i;c.strokeStyle=i===0?'#c9ffff':i===1?'#55ecff':'#1a8298';c.globalAlpha=1-i*.22;c.stroke()}c.globalAlpha=1;c.beginPath();c.moveTo(220,256);c.lineTo(292,256);c.moveTo(272,232);c.lineTo(296,256);c.lineTo(272,280);c.lineWidth=9;c.lineCap='round';c.strokeStyle='#eaffff';c.stroke()}else{c.beginPath();c.arc(256,256,150,0,Math.PI*2);c.fillStyle=active?'#29ddec':'#052530dd';c.fill();c.lineWidth=active?18:11;c.strokeStyle='#72f5ff';c.stroke();c.fillStyle='#eaffff';c.textAlign='center';c.textBaseline='middle';c.font='bold 142px sans-serif';c.fillText(h.type==='info'?'i':'▣',256,266)}return new THREE.CanvasTexture(cv)}
function hotspotSprite(h){
 const yaw=THREE.MathUtils.degToRad(Number(h.yaw)),pitch=THREE.MathUtils.degToRad(Number(h.pitch)),rad=110;
 const pos=new THREE.Vector3(rad*Math.cos(pitch)*Math.cos(yaw),rad*Math.sin(pitch),rad*Math.cos(pitch)*Math.sin(yaw));
 if(h.type==='scene'){
  const portal=new THREE.Group();portal.position.copy(pos);portal.lookAt(0,0,0);portal.userData=h;portal.userData.baseScale=1;
  // Low-opacity segmented energy portal: asymmetric arcs make rotation visible.
  const ringMaterial=(color,opacity,additive=false)=>new THREE.MeshBasicMaterial({color,transparent:true,opacity,depthTest:false,depthWrite:false,side:THREE.DoubleSide,blending:additive?THREE.AdditiveBlending:THREE.NormalBlending});
  const outer=new THREE.Mesh(new THREE.TorusGeometry(8.8,.20,8,96),ringMaterial(0x36bed4,.38));
  const inner=new THREE.Mesh(new THREE.TorusGeometry(7.25,.10,8,96),ringMaterial(0x8adce7,.42));
  const arc=new THREE.Mesh(new THREE.TorusGeometry(8.3,.16,8,64,Math.PI*.63),ringMaterial(0x70e6ef,.60));
  const arc2=new THREE.Mesh(new THREE.TorusGeometry(7.83,.11,8,64,Math.PI*.44),ringMaterial(0x249db9,.48));
  const aura=new THREE.Mesh(new THREE.RingGeometry(8.85,9.55,96),ringMaterial(0x168ca9,.075));
  aura.position.z=-.2;
  const surface=new THREE.Mesh(new THREE.CircleGeometry(7.0,64),new THREE.MeshBasicMaterial({color:0x123d51,transparent:true,opacity:.10,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));
  surface.position.z=.08;
  const hit=new THREE.Mesh(new THREE.CircleGeometry(9.8,48),new THREE.MeshBasicMaterial({transparent:true,opacity:0,side:THREE.DoubleSide,depthTest:false,depthWrite:false}));hit.position.z=.16;hit.userData=h;hit.userData.portal=portal;
  const sparkGeometry=new THREE.BufferGeometry(),sparkPositions=new Float32Array(24*3);
  for(let i=0;i<24;i++){const angle=i/24*Math.PI*2;const radius=8.1+(i%5)*.33;sparkPositions[i*3]=Math.cos(angle)*radius;sparkPositions[i*3+1]=Math.sin(angle)*radius;sparkPositions[i*3+2]=.25;}
  sparkGeometry.setAttribute('position',new THREE.BufferAttribute(sparkPositions,3));
  const sparks=new THREE.Points(sparkGeometry,new THREE.PointsMaterial({color:0xa7f5ff,size:.62,transparent:true,opacity:.38,depthTest:false,depthWrite:false,blending:THREE.NormalBlending,sizeAttenuation:true}));
  portal.add(aura,outer,inner,arc,arc2,surface,sparks,hit);portal.layers.enableAll();portal.traverse(o=>{o.layers.enableAll();if(o.isMesh||o.isSprite||o.isPoints){o.renderOrder=120;o.material.depthTest=false;o.material.depthWrite=false;}});scene.add(portal);hotspotObjects.push(hit);hotspotVisuals.push(portal);
  const target=tourData.scenes.find(s=>Number(s.id)===Number(h.target_scene_id));if(target?.preview||target?.image)new THREE.TextureLoader().load(target.preview||target.image,t=>{if(!portal.parent){t.dispose();return;}t.colorSpace=THREE.SRGBColorSpace;surface.material.map=t;surface.material.color.set(0xffffff);surface.material.opacity=.28;surface.material.needsUpdate=true});
  // Opaque, high-contrast title plate with readable text at panorama scale.
  const cv=document.createElement('canvas');cv.width=1024;cv.height=224;
  const c=cv.getContext('2d');c.clearRect(0,0,cv.width,cv.height);
  c.fillStyle='rgba(2,18,28,.96)';c.beginPath();c.roundRect(12,14,1000,196,28);c.fill();
  c.strokeStyle='#72e5f0';c.lineWidth=8;c.stroke();
  const title=(h.label||target?.title||'Перейти').trim();
  c.font='bold 66px sans-serif';c.textAlign='center';c.textBaseline='middle';
  const maxWidth=910;let shown=title;
  while(shown.length>1&&c.measureText(shown).width>maxWidth)shown=shown.slice(0,-1);
  if(shown!==title)shown=shown.slice(0,-1)+'…';
  c.shadowColor='#000';c.shadowBlur=12;c.lineWidth=5;c.strokeStyle='#001018';c.strokeText(shown,512,110,maxWidth);
  c.fillStyle='#ffffff';c.fillText(shown,512,110,maxWidth);c.shadowBlur=0;
  const labelTexture=new THREE.CanvasTexture(cv);labelTexture.colorSpace=THREE.SRGBColorSpace;
  const label=new THREE.Sprite(new THREE.SpriteMaterial({map:labelTexture,transparent:true,opacity:1,depthTest:false,depthWrite:false}));
  label.scale.set(20,4.4,1);label.position.set(0,-13.2,.5);portal.add(label);
  label.renderOrder=130;

  portal.userData.animate=(time,active)=>{
   const t=time*.001,scale=active?1.075:1+.012*Math.sin(t*1.4);
   portal.scale.setScalar(THREE.MathUtils.lerp(portal.scale.x,scale,.09));
   outer.rotation.z=t*.22;inner.rotation.z=-t*.31;
   arc.rotation.z=t*.74;arc2.rotation.z=-t*.52+2.1;sparks.rotation.z=-t*.22;
   aura.material.opacity=(active?.14:.065)+.015*Math.sin(t*1.8);
   outer.material.opacity=(active?.57:.34)+.045*Math.sin(t*2.1);
   inner.material.opacity=active?.57:.38;
   arc.material.opacity=(active?.80:.53)+.08*Math.sin(t*2.4);
   arc2.material.opacity=(active?.68:.43)+.06*Math.cos(t*2);
   sparks.material.opacity=active?.58:.30;
   surface.material.opacity=surface.material.map?(active?.40:.24):(active?.18:.09);
  };
 }else{
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:markerTexture(h),transparent:true,depthTest:false}));const base=11;sp.scale.set(base,base,1);sp.position.copy(pos);sp.renderOrder=120;sp.material.depthWrite=false;sp.userData=h;sp.userData.baseScale=base;sp.layers.enableAll();scene.add(sp);hotspotObjects.push(sp);hotspotVisuals.push(sp)
 }
}
hotspotData.forEach(hotspotSprite);
function actionSprite(label,x,action,parent,y=-1.62,z=-3.02,width=1.15){
 const cv=document.createElement('canvas');cv.width=512;cv.height=144;const c=cv.getContext('2d');
 c.fillStyle='#124554';c.fillRect(0,0,512,144);c.strokeStyle='#76efff';c.lineWidth=7;c.strokeRect(4,4,504,136);
 c.fillStyle='#fff';c.font='bold 52px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(label,256,72);
 const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));
 sp.position.set(x,y,z);sp.scale.set(width,.36,1);sp.renderOrder=140;sp.userData.action=action;sp.layers.enableAll();parent.add(sp);interactive.push(sp);return sp;
}
function contentPanel(h){closePanels(contentGroup);clearGroup(contentGroup);contentGroup.userData.stereoPictures=null;contentGroup.visible=true;
 const head=document.createElement('canvas');head.width=1000;head.height=190;const c=head.getContext('2d');c.fillStyle='#031720f4';c.fillRect(0,0,1000,190);c.strokeStyle='#5cecff';c.lineWidth=6;c.strokeRect(5,5,990,185);c.fillStyle='#65efff';c.font='bold 24px monospace';c.fillText(h.type==='image'?'IMAGE':'INFORMATION',42,48);c.fillStyle='#fff';c.font='bold 43px sans-serif';c.fillText((h.label||'').slice(0,36),42,118);
 const hs=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(head),transparent:true,depthTest:false}));hs.scale.set(4.3,.82,1);hs.position.set(0,1.12,-3.08);hs.renderOrder=132;contentGroup.add(hs);
 if(h.type==='image'&&h.content){new THREE.TextureLoader().load(h.content,t=>{
  if(!contentGroup.visible){t.dispose();return}
  t.colorSpace=THREE.SRGBColorSpace;
  const stereo=['sbs','tb'].includes(h.image_stereo)?h.image_stereo:'mono';
  const im=t.image||{},aspect=im.width&&im.height?im.width/im.height:16/9;
  const eyeAspect=stereo==='sbs'?aspect/2:stereo==='tb'?aspect*2:aspect;
  const maxW=4.15,maxH=2.25;let w=maxW,hg=w/eyeAspect;if(hg>maxH){hg=maxH;w=hg*eyeAspect}
  const addPicture=(texture,layer)=>{
   const pic=new THREE.Sprite(new THREE.SpriteMaterial({map:texture,transparent:true,depthTest:false,depthWrite:false}));
   pic.scale.set(w,hg,1);pic.position.set(0,-.18,-3.04);pic.renderOrder=131;pic.layers.set(layer);contentGroup.add(pic);return pic;
  };
  if(stereo==='mono'){addPicture(t,0);contentGroup.userData.stereoPictures=null;return}
  // Desktop: left eye as a normal 2D preview. Cardboard/WebXR: separate texture per eye.
  const left=t.clone();left.needsUpdate=true;left.repeat.set(stereo==='sbs'?.5:1,stereo==='tb'?.5:1);left.offset.set(0,stereo==='tb'?.5:0);
  const right=t.clone();right.needsUpdate=true;right.repeat.set(stereo==='sbs'?.5:1,stereo==='tb'?.5:1);right.offset.set(stereo==='sbs'?.5:0,0);
  const desktop=addPicture(left.clone(),0),leftPic=addPicture(left,1),rightPic=addPicture(right,2);
  contentGroup.userData.stereoPictures={desktop,leftPic,rightPic};
  t.dispose();
 },undefined,()=>addInfoText('Не удалось загрузить изображение'))}
 else addInfoText(h.content||'Нет информации');
 actionSprite('CLOSE',0,()=>{contentGroup.visible=false;clearGroup(contentGroup)},contentGroup,-1.62,-3.02,1.15);
 function addInfoText(text){const cv=document.createElement('canvas');cv.width=1000;cv.height=560;const x=cv.getContext('2d');x.fillStyle='#031720f4';x.fillRect(0,0,1000,560);x.strokeStyle='#5cecff';x.lineWidth=5;x.strokeRect(4,4,992,552);x.fillStyle='#e9ffff';x.font='28px sans-serif';const words=String(text).split(' ');let line='',y=60;for(const w of words){const test=line+w+' ';if(x.measureText(test).width>890){x.fillText(line,45,y);line=w+' ';y+=43}else line=test;if(y>500)break}x.fillText(line,45,y);const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:new THREE.CanvasTexture(cv),transparent:true,depthTest:false}));sp.scale.set(4.3,2.4,1);sp.position.set(0,-.12,-3.04);sp.renderOrder=131;contentGroup.add(sp)}
}
const raycaster=new THREE.Raycaster();let gazeTarget=null,gazeStart=0;
const gazeCursor=new THREE.Group();const gazeBase=new THREE.Mesh(new THREE.RingGeometry(.018,.025,48),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.72,depthTest:false}));const gazeProgress=new THREE.Mesh(new THREE.RingGeometry(.028,.034,48,1,Math.PI/2,0.001),new THREE.MeshBasicMaterial({color:0x66f4ff,transparent:true,opacity:.95,depthTest:false}));gazeBase.renderOrder=gazeProgress.renderOrder=200;gazeCursor.add(gazeBase,gazeProgress);gazeCursor.position.set(0,0,-1.25);gazeCursor.visible=false;camera.add(gazeCursor);
function updateGazeCursor(hit,progress){gazeCursor.visible=false;gazeProgress.geometry.dispose();gazeProgress.geometry=new THREE.RingGeometry(.028,.034,48,1,Math.PI/2,Math.max(.001,Math.PI*2*progress));gazeBase.material.color.setHex(hit?0x66f4ff:0xffffff)}const pickables=()=>[...hotspotObjects,...interactive.filter(o=>o.visible&&o.parent?.visible!==false)];
function activate(o){if(o?.userData?.action)return o.userData.action();const h=o?.userData;if(!h)return;if(h.type==='scene'&&h.target_panorama_id)return navigate('/viewer.php?id='+h.target_panorama_id+'&tour='+tour+'&scene='+h.target_scene_id);if(h.type==='info'||h.type==='image'){contentPanel(h);const modal=document.querySelector('#hotspot-modal');document.querySelector('#hotspot-modal-type').textContent=h.type==='image'?'ИЗОБРАЖЕНИЕ':'ИНФОРМАЦИЯ';document.querySelector('#hotspot-modal-title').textContent=h.label||'';const box=document.querySelector('#hotspot-modal-content');box.replaceChildren();if(h.type==='image'&&h.content){const img=document.createElement('img');img.alt=h.label||'Фото';img.src=h.content;img.style.maxWidth='100%';box.append(img);if(['sbs','tb'].includes(h.image_stereo)){const note=document.createElement('p');note.textContent='Стереофото '+h.image_stereo.toUpperCase()+': для объёмного просмотра откройте Cardboard или VR. Здесь показана исходная стереопара.';box.append(note);const open=document.createElement('button');open.type='button';open.textContent='⛶ Открыть на весь экран · 3D';open.style.cssText='display:block;margin:12px 0;padding:12px 18px;background:#126e82;color:white;border:1px solid #6ce3ef;cursor:pointer';open.onclick=()=>window.openMiniVRStereoPhoto?.(h.content,h.image_stereo,h.label,h.depth_map||null);box.append(open);img.style.cursor='zoom-in';img.onclick=open.onclick}}else box.textContent=h.content||'';if(!cardboard&&!renderer.xr.isPresenting)modal.classList.add('open')}}
document.querySelector('#hotspot-close').onclick=()=>document.querySelector('#hotspot-modal').classList.remove('open');
for(let i=0;i<2;i++){const ctl=renderer.xr.getController(i);const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0),new THREE.Vector3(0,0,-1)]),new THREE.LineBasicMaterial({color:0x66eeff}));line.scale.z=4;ctl.add(line);ctl.addEventListener('select',()=>{raycaster.setFromXRController(ctl);activate(raycaster.intersectObjects(pickables(),false)[0]?.object)});scene.add(ctl)}

// Desktop wheel and mobile two-finger pinch zoom (perspective FOV, no texture resampling).
const zoomMin=30,zoomMax=95,activeTouches=new Map();
let pinchDistance=0,pinchFov=75;
function seamSafeHalfAngle(){
 if(effectSettings.hideSeamDuringRotation!==true||projection!=='360'||stereoMode!=='mono')return 0;
 const canvas=renderer.domElement,width=Math.max(1,canvas.clientWidth||canvas.width||1);
 const height=Math.max(1,canvas.clientHeight||canvas.height||1);
 const aspect=width/height;
 const halfFov=Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov||75)/2)*aspect);
 const marginAngle=halfFov*(15/width);
 // Stop 15 CSS pixels INSIDE the visible viewport, not outside it.
 return THREE.MathUtils.radToDeg(Math.max(0,halfFov-marginAngle));
}
function clampYawAtVisibleSeam(candidate,reference,direction=0){
 const limit=seamSafeHalfAngle();
 if(!limit)return candidate;
 const wrap=a=>THREE.MathUtils.euclideanModulo(a+180,360)-180;
 const relative=wrap(-candidate);
 // Permit the seam to travel across the image; clamp only when it reaches
 // the inner 15px safety line near either horizontal edge.
 if(Math.abs(relative)<=limit)return candidate;
 const side=Math.sign(relative)||Math.sign(-direction)||1;
 return wrap(-side*limit);
}
const canZoom=()=>!cardboard&&!legacyCardboard&&!renderer.xr.isPresenting;
function setZoom(fov){if(!canZoom())return;camera.fov=THREE.MathUtils.clamp(fov,zoomMin,zoomMax);camera.updateProjectionMatrix();}
renderer.domElement.style.touchAction='none';
renderer.domElement.addEventListener('wheel',e=>{if(!canZoom())return;e.preventDefault();setZoom(camera.fov+Math.sign(e.deltaY)*Math.min(9,Math.abs(e.deltaY)*.035));},{passive:false});
renderer.domElement.addEventListener('pointerdown',e=>{if(e.pointerType!=='touch')return;activeTouches.set(e.pointerId,[e.clientX,e.clientY]);if(activeTouches.size===2){const [a,b]=[...activeTouches.values()];pinchDistance=Math.hypot(a[0]-b[0],a[1]-b[1]);pinchFov=camera.fov;down=false;moved=true;}});
renderer.domElement.addEventListener('pointermove',e=>{if(!activeTouches.has(e.pointerId))return;activeTouches.set(e.pointerId,[e.clientX,e.clientY]);if(activeTouches.size===2&&pinchDistance>0){const [a,b]=[...activeTouches.values()],distance=Math.hypot(a[0]-b[0],a[1]-b[1]);if(distance>0)setZoom(pinchFov*pinchDistance/distance);down=false;moved=true;}});
const releaseTouch=e=>{activeTouches.delete(e.pointerId);if(activeTouches.size<2)pinchDistance=0;};
renderer.domElement.addEventListener('pointerup',releaseTouch);
renderer.domElement.addEventListener('pointercancel',releaseTouch);
let moved=false;renderer.domElement.addEventListener('pointerdown',e=>{seamRotationPaused=false;down=true;moved=false;x0=e.clientX;y0=e.clientY;lon0=lon;lat0=lat});
addEventListener('pointerup',e=>{if(down&&!moved&&activeTouches.size<2&&!cardboard&&!renderer.xr.isPresenting){const r=renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(p,camera);activate(raycaster.intersectObjects(hotspotObjects,false)[0]?.object)}down=false});addEventListener('pointermove',e=>{
 if(down&&!moved&&(Math.abs(e.clientX-x0)>5||Math.abs(e.clientY-y0)>5)){
  moved=true;
  if(getViewerMode()===ViewerMode.DESKTOP&&!orientation&&projection==='360'&&stereoMode==='mono'&&parallaxDepthPixels&&effectSettings.parallaxEnabled)stopDepthTranslationForRotation();
 }
 if(down&&activeTouches.size<2&&!orientation&&!desktop3DWindow.isDragging()){const targetLon=lon0+(x0-e.clientX)*.12;lon=clampYawAtVisibleSeam(targetLon,lon0,targetLon-lon0);lat=Math.max(-85,Math.min(85,lat0+(e.clientY-y0)*.12))}
});
addEventListener('pointercancel',()=>{down=false});
addEventListener('blur',()=>{down=false});


function resize(){renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()}addEventListener('resize',resize);resize();
const gyroButton=document.querySelector('#gyro');
const mobileMotion=createMobileMotionParallax(window);
const mobileMotionButton=document.createElement('button');
mobileMotionButton.id='mobile-motion-parallax';
mobileMotionButton.type='button';
mobileMotionButton.hidden=true;
mobileMotionButton.setAttribute('aria-pressed','false');
mobileMotionButton.setAttribute('aria-label','Параллакс от наклона телефона');
document.body.appendChild(mobileMotionButton);
let mobileMotionPending=false;
function mobileMotionSensorSupported(){
 return getViewerMode()===ViewerMode.DESKTOP
  &&window.matchMedia('(pointer: coarse)').matches&&window.isSecureContext
  &&typeof window.DeviceOrientationEvent!=='undefined';
}
function mobileMotionEligible(){
 return mobileMotionSensorSupported()&&projection==='360'&&stereoMode==='mono'
  &&!!parallaxDepthPixels&&effectSettings.parallaxEnabled===true;
}
function syncMobileMotionButton(){
 mobileMotionButton.hidden=!mobileMotionEligible();
 mobileMotionButton.setAttribute('aria-pressed',String(mobileMotion.isActive()));
 mobileMotionButton.textContent=mobileMotionPending?'3D…':mobileMotion.isActive()?'↔ 3D ✓':'↔ 3D';
 mobileMotionButton.title=mobileMotion.isActive()?'Выключить параллакс от наклона телефона':'Включить параллакс от наклона телефона (требуется доступ к датчику)';
}
function stopMobileMotion(){
 mobileMotion.stop();
 depthPointer.set(0,0);
 syncMobileMotionButton();
}
mobileMotionButton.onclick=async()=>{
 if(mobileMotionPending)return;
 if(mobileMotion.isActive()){stopMobileMotion();return;}
 if(!mobileMotionEligible())return;
 mobileMotionPending=true;mobileMotionButton.disabled=true;syncMobileMotionButton();
 let started=false;
 try{started=await mobileMotion.start();if(started&&!mobileMotionEligible()){stopMobileMotion();started=false;}}
 catch(error){console.warn('MiniVR mobile motion unavailable',error)}
 finally{
  mobileMotionPending=false;mobileMotionButton.disabled=false;syncMobileMotionButton();
  if(!started&&!mobileMotionButton.hidden){
   mobileMotionButton.textContent='3D недоступен';
   setTimeout(syncMobileMotionButton,2200);
  }
 }
};
syncMobileMotionButton();
let gyroPending=false;
let gyroAbort=null;
const gyroNotice=document.createElement('section');
gyroNotice.id='minivr-gyro-diagnostic';
gyroNotice.hidden=true;
gyroNotice.setAttribute('role','status');
gyroNotice.setAttribute('aria-live','polite');
const gyroMessage=document.createElement('p');
const gyroActions=document.createElement('div');
const gyroRetry=document.createElement('button');
gyroRetry.type='button';gyroRetry.textContent='↻ Повторить попытку';gyroRetry.hidden=true;
const gyroDismiss=document.createElement('button');
gyroDismiss.type='button';gyroDismiss.textContent='Закрыть';
gyroActions.append(gyroRetry,gyroDismiss);gyroNotice.append(gyroMessage,gyroActions);
document.body.appendChild(gyroNotice);

function showGyroStatus(message,{error=false,retry=false}={}){
 gyroNotice.hidden=false;
 gyroNotice.dataset.state=error?'error':'info';
 gyroNotice.setAttribute('role',error?'alert':'status');
 gyroMessage.textContent=message;
 gyroRetry.hidden=!retry;
 gyroRetry.disabled=gyroPending;
}
function stopGyroObservation(){
 window.removeEventListener('deviceorientation',observeGyro);
 window.removeEventListener('deviceorientationabsolute',observeGyro);
}
function observeGyro(event){
 if(!validGyroSample(event))return;
 // DeviceOrientationControls listens to `deviceorientation` only. Some Android
 // browsers emit only `deviceorientationabsolute`, so forward that sample too.
 if(event.type==='deviceorientationabsolute')deviceOrientation.deviceOrientation=event;
}
function setGyroActive(active){
 stopGyroObservation();
 orientation=active;
 if(active){
  deviceOrientation.connect();
  window.addEventListener('deviceorientation',observeGyro);
  window.addEventListener('deviceorientationabsolute',observeGyro);
 }
 else deviceOrientation.disconnect();
 gyroButton.setAttribute('aria-pressed',String(active));
 gyroButton.textContent=active?'GYRO ✓':'GYRO';
 syncMobileMotionButton();
}
gyroButton.setAttribute('aria-pressed','false');
function gyroFailureMessage(result){
 switch(result.status){
  case 'insecure':return 'GYRO работает только на защищённом сайте (HTTPS). Откройте адрес через https:// и повторите.';
  case 'unsupported':return 'Браузер планшета не предоставляет датчик ориентации. Проверьте наличие датчиков или откройте сайт в Chrome/Safari.';
  case 'denied':return 'Доступ к движению и ориентации запрещён. Разрешите датчики в настройках браузера, затем нажмите «Повторить попытку».';
  case 'permission-error':return 'Браузер не смог запросить разрешение на датчики. Проверьте настройки сайта и повторите нажатием кнопки.';
  case 'invalid-data':return 'События ориентации приходят, но углы alpha/beta/gamma пустые. Браузер или система блокирует данные датчика.';
  default:return 'За '+(GYRO_SAMPLE_TIMEOUT_MS/1000)+' секунд данные датчика не поступили. Поверните планшет, проверьте разрешения и повторите.';
 }
}
async function startGyro(){
 if(gyroPending)return;
 if(orientation){setGyroActive(false);gyroNotice.hidden=true;return;}
 if(getViewerMode()!==ViewerMode.DESKTOP)return;
 gyroPending=true;
 gyroAbort=new AbortController();
 gyroButton.disabled=true;
 gyroButton.textContent='GYRO…';
 showGyroStatus('Проверяем датчики ориентации (до '+(GYRO_SAMPLE_TIMEOUT_MS/1000)+' секунд). Плавно поверните планшет.');
 try{
  const result=await requestGyroSample(window,{signal:gyroAbort.signal});
  if(result.status==='cancelled'||getViewerMode()!==ViewerMode.DESKTOP)return;
  if(result.status==='ready'){
   setGyroActive(true);
   observeGyro(result.event);
   gyroButton.title='GYRO включён. Нажмите ещё раз для выключения.';
   showGyroStatus('GYRO включён. Теперь поворачивайте планшет, чтобы осматривать панораму.');
  }else{
   const message=gyroFailureMessage(result);
   gyroButton.title=message;
   showGyroStatus(message,{error:true,retry:true});
  }
 }finally{
  gyroPending=false;gyroAbort=null;gyroButton.disabled=false;
  gyroRetry.disabled=false;
  gyroButton.textContent=orientation&&getViewerMode()===ViewerMode.DESKTOP?'GYRO ✓':'GYRO';
 }
}
gyroButton.onclick=startGyro;
gyroRetry.onclick=startGyro;
gyroDismiss.onclick=()=>{gyroNotice.hidden=true;};
window.addEventListener('pagehide',()=>{gyroAbort?.abort();stopGyroObservation();});
document.querySelector('#full').onclick=()=>document.documentElement.requestFullscreen?.();
const vrControl=document.querySelector('#vr');vrControl.textContent='ENTER VR';let xrSession=null;
async function startImmersiveVR(){
 if(cardboard||renderer.xr.isPresenting)return;
 if(!navigator.xr){await toggleCardboard();return}
 try{
  const supported=await navigator.xr.isSessionSupported?.('immersive-vr');
  if(!supported){await toggleCardboard();return}
  xrSession=await navigator.xr.requestSession('immersive-vr',{optionalFeatures:['local-floor','bounded-floor','hand-tracking']});
  xrSession.addEventListener('end',()=>{xrSession=null},{once:true});
  await renderer.xr.setSession(xrSession);
 }catch(err){
  console.warn('WebXR immersive-vr failed; using Cardboard fallback',err);
  if(!renderer.xr.isPresenting)await toggleCardboard();
 }
}
vrControl.onclick=startImmersiveVR;

// User-calibrated fallback for Cardboard headsets without a VRDisplay profile.
// Values are screen-relative, so they work across different phone resolutions.
const cardboardCalibrationKey='minivr:cardboard:calibration:v2';
const cardboardCalibrationDefaults={scale:1,spacing:0,vertical:0,fov:75};
let cardboardCalibration={...cardboardCalibrationDefaults};
try{
 const saved=JSON.parse(localStorage.getItem(cardboardCalibrationKey)||'null');
 if(saved&&typeof saved==='object')for(const key of Object.keys(cardboardCalibrationDefaults)){
  const value=Number(saved[key]);if(Number.isFinite(value))cardboardCalibration[key]=value;
 }
}catch{}
function makeCardboardCalibrationPanel(){
 const panel=document.createElement('div');
 panel.id='cardboard-calibration';
 panel.style.cssText='position:fixed;z-index:10020;left:50%;top:12px;transform:translateX(-50%);width:min(92vw,360px);max-height:85vh;overflow:auto;padding:12px;border-radius:12px;background:#061522f2;color:#fff;font:13px system-ui;box-shadow:0 8px 35px #000b;display:none';
 const title=document.createElement('div');title.textContent='Настройка линз Cardboard';title.style.cssText='font-weight:700;margin-bottom:8px';panel.appendChild(title);
 const fields=[['scale','Масштаб внутри линз',0.6,1,0.01],['spacing','Расстояние между центрами',-0.2,0.2,0.005],['vertical','Смещение по высоте',-0.15,0.15,0.005],['fov','Поле зрения',55,105,1]];
 const update=()=>{try{localStorage.setItem(cardboardCalibrationKey,JSON.stringify(cardboardCalibration))}catch{}};
 const inputs={};
 for(const [key,label,min,max,step] of fields){
  const wrap=document.createElement('label');wrap.style.cssText='display:block;margin:8px 0';
  const text=document.createElement('div');text.textContent=label;wrap.appendChild(text);
  const range=document.createElement('input');range.type='range';range.min=min;range.max=max;range.step=step;range.value=cardboardCalibration[key];range.style.width='85%';
  const output=document.createElement('span');output.style.marginLeft='5px';output.textContent=range.value;
  range.addEventListener('input',()=>{cardboardCalibration[key]=Number(range.value);output.textContent=range.value;update()});
  wrap.append(range,output);panel.appendChild(wrap);inputs[key]={range,output};
 }
 const note=document.createElement('div');note.textContent='Совместите центры изображений с линзами. Настройки сохраняются для этого браузера. Для VR-устройств с собственным профилем используется их штатная оптика.';note.style.cssText='opacity:.8;margin:8px 0';panel.appendChild(note);
 const reset=document.createElement('button');reset.textContent='Сброс';reset.onclick=()=>{cardboardCalibration={...cardboardCalibrationDefaults};for(const [key,input] of Object.entries(inputs)){input.range.value=cardboardCalibration[key];input.output.textContent=String(cardboardCalibration[key])}update()};
 const close=document.createElement('button');close.textContent='Закрыть';close.onclick=()=>panel.style.display='none';close.style.marginLeft='12px';
 panel.append(reset,close);document.body.appendChild(panel);
 const open=document.createElement('button');open.textContent='⚙ Линзы';open.title='Калибровка Cardboard';open.style.cssText='position:fixed;right:12px;top:12px;z-index:10019;padding:7px 11px;border-radius:8px;background:#061522dd;color:white;border:1px solid #43849d;display:none';
 open.onclick=()=>panel.style.display=panel.style.display==='none'?'block':'none';document.body.appendChild(open);open.style.display='block';
 return {panel,open};
}
const cardboardCalibrationUI=makeCardboardCalibrationPanel();
function syncCardboardCalibrationUI(){
 const visible=true; // Allow calibration before putting the phone into the headset.
 cardboardCalibrationUI.open.style.display=visible?'block':'none';
 if(!visible)cardboardCalibrationUI.panel.style.display='none';
}
function updateCardboardEyes(){
 // A wider, but bounded, stereo baseline is useful for the depth-derived shell.
 // Physical eye separation remains comfortable; depth-derived geometry supplies
 // the parallax, rather than exaggerating stereo disparity at 75% strength.
 cardboardStereo.eyeSep=.064;
 const size=renderer.getDrawingBufferSize(new THREE.Vector2()),half=Math.max(1,Math.floor(size.x/2));
 camera.aspect=half/Math.max(1,size.y);camera.fov=cardboardCalibration.fov;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);cardboardStereo.aspect=1;cardboardStereo.update(camera);
 const l=cardboardStereo.cameraL,r=cardboardStereo.cameraR;
 if(stereoMode==='mono'){l.layers.set(0);r.layers.set(0)}else{l.layers.disableAll();l.layers.enable(0);l.layers.enable(1);r.layers.disableAll();r.layers.enable(0);r.layers.enable(2)}
 return {size,half,l,r};
}
function renderCardboard(){
 const {size,half,l,r}=updateCardboardEyes();
 // Each eye always owns exactly half of the physical framebuffer. Do not
 // shrink or translate viewports: that produces black strips and off-center eyes.
 const scale=THREE.MathUtils.clamp(Number(cardboardCalibration.scale)||1,.6,1);
 const spacing=THREE.MathUtils.clamp(Number(cardboardCalibration.spacing)||0,-.2,.2);
 const vertical=THREE.MathUtils.clamp(Number(cardboardCalibration.vertical)||0,-.15,.15);
 for(const [eye,sign] of [[l,-1],[r,1]]){
  // Adjust optical framing inside the fixed viewport, not the viewport itself.
  // Scaling both focal axes preserves aspect ratio; projection offsets move
  // the optical centers without leaving uncovered pixels.
  const e=eye.projectionMatrix.elements;
  e[0]*=scale;e[5]*=scale;
  e[8]+=sign*spacing*2;
  e[9]+=vertical*2;
  eye.projectionMatrixInverse.copy(eye.projectionMatrix).invert();
 }
 renderer.setRenderTarget(null);
 renderer.autoClear=false;
 renderer.setScissorTest(true);
 renderer.setViewport(0,0,size.x,size.y);
 renderer.setScissor(0,0,size.x,size.y);
 renderer.clear(true,true,true);
 for(const [eye,x,width] of [[l,0,half],[r,half,size.x-half]]){
  renderer.setViewport(x,0,width,size.y);
  renderer.setScissor(x,0,width,size.y);
  renderer.clearDepth();
  renderer.render(scene,eye);
 }
 renderer.setScissorTest(false);
 renderer.setViewport(0,0,size.x,size.y);
 renderer.autoClear=true;
}
function clearSceneHotspots(){
 for(const obj of hotspotVisuals){
  scene.remove(obj);
  obj.traverse(node=>{
   node.geometry?.dispose?.();
   if(node.material){
    const materials=Array.isArray(node.material)?node.material:[node.material];
    for(const material of materials){material.map?.dispose?.();material.dispose();}
   }
  });
 }
 hotspotVisuals.length=0;hotspotObjects.length=0;
 hotspotData=[];activeHotspot=null;hoveredPortal=null;
 gazeTarget=null;gazeStart=0;
 document.body.classList.remove('gazing');
 document.querySelector('#hotspot-modal')?.classList.remove('open');
}
let sceneSwitchInProgress=false;
const cardboardRestoreKey='minivr:cardboard:restore';
async function loadSceneTexture(image,preloadedBlob){
 const loader=new THREE.TextureLoader();
 if(!preloadedBlob)return loader.loadAsync(image);
 const objectUrl=URL.createObjectURL(preloadedBlob);
 try{return await loader.loadAsync(objectUrl);}
 catch(error){console.warn('Cached scene image unavailable; loading original',error);return loader.loadAsync(image);}
 finally{URL.revokeObjectURL(objectUrl);}
}
async function switchSceneInPlace(url,{pushHistory=true}={}){
 const prepared=scenePreloader.getReady(url);
 // If this scene is not fully ready, the normal viewer loader takes over.
 // Stop its background fetch so the same large image is not downloaded twice.
 if(!prepared)scenePreloader.cancel(url);
 let html=prepared?.html;
 if(!html){
  const response=await fetch(url,{credentials:'same-origin'});
  if(!response.ok)throw new Error('Scene HTTP '+response.status);
  html=await response.text();
 }
 const doc=new DOMParser().parseFromString(html,'text/html');
 const next=doc.querySelector('#viewer');
 if(!next)throw new Error('Scene data missing');
 const image=next.dataset.image;
 const nextProjection=next.dataset.projection||'360',nextStereo=next.dataset.stereo||'mono';
 let nextSettings={};try{nextSettings=JSON.parse(next.dataset.effects||'{}')}catch{}
 nextSettings.timeOfDay=false;nextSettings.dayCycle=false;
 const nextTour=JSON.parse(doc.querySelector('#tour-data')?.textContent||'{}');
 const nextHotspots=JSON.parse(doc.querySelector('#hotspots-data')?.textContent||'[]');
 // Prepare the next scene before touching the one currently being viewed.
 // Depth, masks and settings must belong to the same panorama as its texture.
 const [nextDepth,nextFoliage,nextWater]=await Promise.all([
  fetchParallaxDepth(nextSettings,nextProjection,nextStereo,prepared?.assets?.depth),
  fetchManualFoliageMask(nextSettings,prepared?.assets?.foliage),
  fetchManualWaterMask(nextSettings,prepared?.assets?.water)
 ]);
 let nextTiles=null,texture=null;
 if(nextProjection==='360'&&nextStereo==='mono'&&next.dataset.tiles&&(!nextDepth||canUseTiledDepth(nextSettings))){
  try{
   nextTiles=await createTiledPanorama({url:next.dataset.tiles,scene,camera,renderer,mirror:!!nextSettings.mirrorHorizontal,
    manifest:prepared?.manifest,baseTiles:prepared?.baseTiles,depth:tiledDepthConfig(nextSettings,nextDepth),
    foliage:tiledFoliageConfig(nextSettings,nextFoliage),seamBlur:seamBlurAmount(nextSettings.seamBlurStrength)});
   if(nextTiles.group)nextTiles.group.visible=false;
  }catch(error){console.warn('Tour scene tiles unavailable, using image',error)}
 }
 if(!nextTiles){if(!image)throw new Error('Scene image missing');texture=await loadSceneTexture(image,prepared?.assets?.image);}
 ++panoramaLoadEpoch;
 clearSceneHotspots();
 if(tiledPanorama){tiledPanorama.dispose();tiledPanorama=null;}
 projection=nextProjection;stereoMode=nextStereo;effectSettings=nextSettings;
 parallaxDepthPixels=nextDepth;manualFoliageMaskImage=nextFoliage;manualWaterMaskImage=nextWater;
 effectSystem?.dispose();atmosphereSystem?.dispose();moonSystem?.dispose();environmentSystem?.dispose();panoramaObjectSystem?.dispose();panoramaObjectSystem=null;
 // Each effect module owns its animation state; fresh instances start with
 // the next panorama's settings. Legacy day-cycle globals no longer exist.
 effectSystem=createPanoramaEffects(scene,effectSettings);atmosphereSystem=createAtmosphere(scene,effectSettings);moonSystem=createMoonlight(scene,effectSettings);environmentSystem=createEnvironment(scene,effectSettings);
 let nextObjects=[];try{nextObjects=JSON.parse(next.getAttribute('data-3d-objects')||'[]')}catch{}
 panoramaObjectSystem=await createPanorama3DObjects(scene,camera,nextObjects);
 if(nextTiles){
  clearPanoramaMeshes();tiledPanorama=nextTiles;if(nextTiles.group)nextTiles.group.visible=true;
  if(getViewerMode()===ViewerMode.DESKTOP)camera.layers.set(0);
  document.body.classList.remove('scene-loading');
 }else installPanorama(texture);
 tourData.current=nextTour.current??-1;
 tourData.title=nextTour.title||'';tourData.description=nextTour.description||'';
 guidedPoints=sceneNarrationPoints();
 guidedEnabled=!!tour&&guidedPoints.length>0;
 guidedSetup();
 resetTourTimer();
 window.dispatchEvent(new CustomEvent('minivr:scene-music',{detail:{trackId:Number(next.dataset.musicTrack||0)}}));
 hotspotData=nextHotspots;
 hotspotData.forEach(hotspotSprite);
 closePanels();menuPage=Math.max(0,Math.floor(Math.max(0,tourData.current)/6));buildMenu();
 root.dataset.image=image;root.dataset.tiles=next.dataset.tiles||'';root.dataset.effects=next.dataset.effects||'{}';root.setAttribute('data-3d-objects',next.getAttribute('data-3d-objects')||'[]');try{panoramaObjectData=JSON.parse(root.getAttribute('data-3d-objects')||'[]')}catch{panoramaObjectData=[]}bloomStrength=panoramaObjectData.filter(o=>o.bloom&&o.visible!==false).reduce((m,o)=>Math.max(m,Number(o.bloomStrength)||1.2),0);
 root.dataset.projection=projection;root.dataset.stereo=stereoMode;
 root.dataset.scene=next.dataset.scene;root.dataset.musicTrack=next.dataset.musicTrack||'0';
 document.title=doc.title;
 const topTitle=doc.querySelector('#top b'),currentTitle=document.querySelector('#top b');
 if(topTitle&&currentTitle)currentTitle.textContent=topTitle.textContent;
 if(pushHistory)history.pushState({miniVRScene:true},'',url);
 syncTourRail();syncMobileTourNav();syncTourMap();syncMobileMotionButton();
 cardboardMenuPlaced=false;
 if(getViewerMode()===ViewerMode.CARDBOARD)placeCardboardMenu();
 queueNeighborPreload();
}
function reportSceneSwitchError(error){
 console.error('Tour scene switch failed; keeping the current viewing mode',error);
 const notice=document.createElement('div');notice.textContent='Не удалось загрузить панораму. Попробуйте ещё раз.';
 notice.style.cssText='position:fixed;z-index:1000;left:50%;top:70px;transform:translateX(-50%);max-width:90vw;background:#251b1deF;color:white;padding:12px 16px;border:1px solid #fa7990;border-radius:9px;font:13px system-ui';
 document.body.appendChild(notice);setTimeout(()=>notice.remove(),4500);
}
function startSceneSwitch(url,pushHistory=true){
 if(sceneSwitchInProgress)return;
 sceneSwitchInProgress=true;document.body.classList.add('scene-loading');
 switchSceneInPlace(url,{pushHistory}).catch(reportSceneSwitchError)
  .finally(()=>{sceneSwitchInProgress=false;document.body.classList.remove('scene-loading')});
}
function navigate(url){
 if(document.body.classList.contains('scene-leaving'))return;
 const target=viewerTargetWithEmbed(new URL(url,location.href),location.origin,embedToken);
 if(target.href===location.href)return;
 // Do not replace a partner site's iframe with the MiniVR homepage.
 if(embedToken&&target.origin===location.origin&&target.pathname==='/'){
  location.href='/embed.php?token='+encodeURIComponent(embedToken);return;
 }
 if(shouldSwitchSceneInPlace(target,location.origin,tour,tourData.scenes,getViewerMode())){startSceneSwitch(target.pathname+target.search);return;}
 if(getViewerMode()===ViewerMode.CARDBOARD){
  try{sessionStorage.setItem(cardboardRestoreKey,JSON.stringify({path:target.pathname,expires:Date.now()+30000}))}catch{}
 }else{try{sessionStorage.removeItem(cardboardRestoreKey)}catch{}}
 document.body.classList.add('scene-leaving');
 setTimeout(()=>location.href=target.href,260)
}
window.addEventListener('popstate',()=>{
 if(!tour||location.pathname!=='/viewer.php')return;
 if(Number(new URLSearchParams(location.search).get('tour'))!==tour)return;
 if(Number(new URLSearchParams(location.search).get('scene'))===Number(root.dataset.scene))return;
 startSceneSwitch(location.pathname+location.search,false);
});
async function restoreCardboardAfterNavigation(){
 let saved=null;
 try{saved=JSON.parse(sessionStorage.getItem(cardboardRestoreKey)||'null');sessionStorage.removeItem(cardboardRestoreKey)}catch{}
 if(!saved||saved.path!=='/viewer.php'||Date.now()>saved.expires)return;
 // Browsers may require a fresh gesture for fullscreen; stereo presentation itself is restored.
 await toggleCardboard();
}
async function toggleCardboard(){
 gyroAbort?.abort();stopGyroObservation();gyroNotice.hidden=true;
 if(renderer.xr.isPresenting)return;
 if(legacyCardboard&&legacyVRDisplay){try{await legacyVREffect.exitPresent()}catch{}legacyCardboard=false;cardboard=false;syncCardboardCalibrationUI();hud.visible=false;cardboardMenu.visible=false;cardboardReticle.visible=false;cardboardMenuPlaced=false;document.body.classList.remove('cardboard');document.querySelector('#controls').style.display='';document.querySelector('#top').style.display='';resize();return}
 try{
  const displays=await navigator.getVRDisplays?.();
  legacyVRDisplay=displays?.[0]||null;
  if(legacyVRDisplay && false){
   legacyVREffect.setVRDisplay(legacyVRDisplay);legacyVRControls.setVRDisplay(legacyVRDisplay);legacyVREffect.setSize(innerWidth,innerHeight,false);
   await legacyVREffect.requestPresent();legacyCardboard=true;cardboard=false;syncCardboardCalibrationUI();orientation=false;deviceOrientation.enabled=false;deviceOrientation.disconnect();camera.layers.enable(0);camera.layers.enable(1);camera.layers.enable(2);hud.visible=false;gazeCursor.visible=false;cardboardMenuPlaced=false;placeCardboardMenu();document.body.classList.add('cardboard');document.querySelector('#controls').style.display='none';document.querySelector('#top').style.display='none';return;
  }
 }catch(err){console.warn('Legacy Cardboard requestPresent failed',err)}
 // Use the calibratable stereo renderer for the Cardboard button on all phones.
 if(typeof DeviceOrientationEvent?.requestPermission==='function'){try{if((await DeviceOrientationEvent.requestPermission())!=='granted')return}catch{return}}
 orientation=true;deviceOrientation.enabled=true;deviceOrientation.connect();cardboard=true;syncCardboardCalibrationUI();hud.visible=false;gazeCursor.visible=false;cardboardMenuPlaced=false;placeCardboardMenu();document.body.classList.add('cardboard');document.querySelector('#controls').style.display='none';document.querySelector('#top').style.display='none';try{await document.documentElement.requestFullscreen?.()}catch{}resize();
}
document.querySelector('#cardboard').onclick=toggleCardboard;
restoreCardboardAfterNavigation().catch(err=>console.warn('Cardboard restore failed',err));

// Cardboard gaze menu: world-locked, based on Ramotion vr-menu-demo focusFire pattern.
const cardboardMenu=new THREE.Group();cardboardMenu.visible=false;scene.add(cardboardMenu);const cardboardTargets=[];let cardboardFocus=null,cardboardFocusStart=0,cardboardMenuPlaced=false;
function cardboardLabel(text){const cv=document.createElement('canvas');cv.width=cv.height=128;const c=cv.getContext('2d');c.clearRect(0,0,128,128);c.fillStyle='#fff';c.font='bold 54px Arial';c.textAlign='center';c.textBaseline='middle';c.fillText(text,64,64);const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.generateMipmaps=false;t.minFilter=THREE.LinearFilter;t.magFilter=THREE.LinearFilter;return t}
function cardboardButton(label,x,action,type){const g=new THREE.Group();const target=new THREE.Mesh(new THREE.CircleGeometry(.18,40),new THREE.MeshBasicMaterial({color:0x0878d1,transparent:true,opacity:.82,side:THREE.DoubleSide}));target.userData={cardboardAction:action,type,baseScale:1};const icon=new THREE.Mesh(new THREE.PlaneGeometry(.22,.22),new THREE.MeshBasicMaterial({map:cardboardLabel(label),transparent:true,opacity:1,depthWrite:false,depthTest:false,alphaTest:.2,side:THREE.DoubleSide}));icon.position.z=.006;g.add(target,icon);g.position.set(x,0,0);cardboardMenu.add(g);cardboardTargets.push(target);return g}
cardboardButton('✕',-.9,()=>exitViewer(),'cb-exit');cardboardButton('‹',-.6,()=>goScene(tourData.current-1),'cb-prev');cardboardButton('⊞',-.3,()=>{menuGroup.visible=!menuGroup.visible;if(menuGroup.visible)buildMenu()},'cb-gallery');cardboardButton('i',0,()=>{infoGroup.visible=!infoGroup.visible},'cb-info');cardboardButton('⌂',.3,()=>navigate('/'),'cb-home');cardboardButton('›',.6,()=>goScene(tourData.current+1),'cb-next');cardboardButton('⟲',.9,()=>{lon=0;lat=0},'cb-reset');
const cardboardReticle=new THREE.Group();
const cbReticleBase=new THREE.Mesh(new THREE.CircleGeometry(.009,32),new THREE.MeshBasicMaterial({color:0xffffff,transparent:true,opacity:.95,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
const cbReticleFuse=new THREE.Mesh(new THREE.RingGeometry(.014,.017,48,1,Math.PI/2,.001),new THREE.MeshBasicMaterial({color:0x00d8ff,transparent:true,opacity:.95,depthTest:false,depthWrite:false,side:THREE.DoubleSide}));
cbReticleBase.renderOrder=1500;cbReticleFuse.renderOrder=1501;
cardboardReticle.add(cbReticleBase,cbReticleFuse);
cardboardReticle.position.set(0,0,-1.2);
camera.add(cardboardReticle);
cardboardReticle.visible=false;
function placeCardboardMenu(){camera.updateMatrixWorld(true);const p=new THREE.Vector3(),q=new THREE.Quaternion(),dir=new THREE.Vector3(0,0,-1);camera.getWorldPosition(p);camera.getWorldQuaternion(q);dir.applyQuaternion(q);cardboardMenu.position.copy(p).add(dir.multiplyScalar(2.2));cardboardMenu.quaternion.copy(q);cardboardMenu.visible=true;cardboardMenuPlaced=true}
function updateCardboardGaze(){if(getViewerMode()!==ViewerMode.CARDBOARD){cardboardReticle.visible=false;return}if(!cardboardMenuPlaced)placeCardboardMenu();cardboardReticle.visible=true;camera.updateMatrixWorld(true);const origin=new THREE.Vector3(),direction=new THREE.Vector3();camera.getWorldPosition(origin);camera.getWorldDirection(direction);raycaster.set(origin,direction);const hit=raycaster.intersectObjects(cardboardTargets,false)[0]?.object||null;if(hit!==cardboardFocus){if(cardboardFocus){cardboardFocus.scale.setScalar(1);cardboardFocus.material.opacity=.82}cardboardFocus=hit;cardboardFocusStart=performance.now()}let p=0;if(hit){p=Math.max(0,Math.min(1,(performance.now()-cardboardFocusStart)/800));hit.scale.setScalar(1-.25*p);hit.material.opacity=.35+.47*(1-p);if(p>=1){cardboardFocusStart=performance.now()+999999;hit.userData.cardboardAction?.()}}cbReticleBase.material.color.setHex(hit?0x00d8ff:0xffffff);cbReticleFuse.geometry.dispose();cbReticleFuse.geometry=new THREE.RingGeometry(.014,.017,48,1,Math.PI/2,Math.max(.001,Math.PI*2*p))}
function updateGaze(){if(getViewerMode()!==ViewerMode.WEBXR)return;const xrCam=renderer.xr.getCamera(camera);const origin=new THREE.Vector3(),direction=new THREE.Vector3(0,0,-1);xrCam.getWorldPosition(origin);xrCam.getWorldDirection(direction);raycaster.set(origin,direction);const hit=raycaster.intersectObjects(pickables(),false)[0]?.object||null;const previous=gazeTarget;if(hit!==previous){if(previous&&hotspotObjects.includes(previous)&&!previous.userData.portal){previous.material.map.dispose();previous.material.map=markerTexture(previous.userData,false);previous.scale.setScalar(previous.userData.baseScale)}if(previous?.material?.color&&previous.userData?.interactive)previous.material.color.setHex(previous.userData.baseColor||0x2a2a2a);if(hit&&hotspotObjects.includes(hit)&&!hit.userData.portal){hit.material.map.dispose();hit.material.map=markerTexture(hit.userData,true);hit.scale.setScalar(hit.userData.baseScale*1.25)}gazeTarget=hit;gazeStart=performance.now();document.body.classList.remove('gazing')}if(hit){document.body.classList.add('gazing');const elapsed=performance.now()-gazeStart,progress=Math.min(1,elapsed/1200);document.documentElement.style.setProperty('--gaze',progress);updateGazeCursor(hit,progress);if(hit.material?.color&&hit.userData?.interactive)hit.material.color.setHex(hit.userData.hoverColor||0x444444);if(elapsed>1200){gazeStart=performance.now()+999999;activate(hit)}}else{document.body.classList.remove('gazing');document.documentElement.style.setProperty('--gaze',0);updateGazeCursor(null,0)}}
renderer.xr.addEventListener('sessionstart',()=>{gyroAbort?.abort();stopGyroObservation();gyroButton.textContent='GYRO';gyroButton.setAttribute('aria-pressed','false');gyroNotice.hidden=true;camera.layers.enable(0);cardboard=false;cardboardDebug.visible=false;orientation=false;deviceOrientation.enabled=false;deviceOrientation.disconnect();document.body.classList.remove('cardboard');document.querySelector('#controls').style.display='none';document.querySelector('#top').style.display='none';hud.visible=true;xrDebug.visible=false;document.body.classList.add('xr-presenting')});
function syncXREyes(){
 if(!renderer.xr.isPresenting)return;
 const xrCam=renderer.xr.getCamera(camera);
 if(!xrCam?.cameras?.length)return;
 for(let i=0;i<xrCam.cameras.length;i++){
  const eye=xrCam.cameras[i];
  eye.layers.disableAll();eye.layers.enable(0);
  // The same depth-deformed 360° geometry is rendered independently from
  // each real XR eye pose; SBS/TB keep their dedicated per-eye textures.
  if(stereoMode!=='mono')eye.layers.enable(i===0?1:2);
 }
}renderer.xr.addEventListener('sessionend',()=>{xrDebug.visible=false;hud.visible=cardboard;document.body.classList.remove('xr-presenting');document.querySelector('#controls').style.display='';document.querySelector('#top').style.display=''});
renderer.domElement.addEventListener('pointermove',e=>{if(getViewerMode()!==ViewerMode.DESKTOP||down)return;const r=renderer.domElement.getBoundingClientRect(),p=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);raycaster.setFromCamera(p,camera);const hit=raycaster.intersectObjects(hotspotObjects,false)[0]?.object||null;hoveredPortal=hit?.userData?.portal||null;hotspotObjects.forEach(o=>{const b=o.userData.baseScale||11,s=o===hit?b*1.23:b;o.scale.lerp(new THREE.Vector3(s,s,1),.18)});renderer.domElement.style.cursor=hit?'pointer':'grab'});
function syncXRDebug(){return;if(!renderer.xr.isPresenting)return;xrDebugCube.rotation.x+=.014;xrDebugCube.rotation.y+=.02}
function syncCardboardDebug(){return;if(!cardboard)return;camera.updateMatrixWorld(true);camera.getWorldPosition(cardboardDebug.position);camera.getWorldQuaternion(cardboardDebug.quaternion);debugCube.rotation.x+=.012;debugCube.rotation.y+=.018}
function placeHudInFront(){
 camera.updateMatrixWorld(true);camera.getWorldPosition(hud.position);camera.getWorldQuaternion(hud.quaternion);hud.scale.setScalar(1)
}
function syncHudPose(){
 const mode=getViewerMode();if(mode===ViewerMode.CARDBOARD)return;
 const head=mode===ViewerMode.WEBXR?renderer.xr.getCamera(camera):camera;
 head.updateMatrixWorld(true);head.getWorldPosition(hud.position);head.getWorldQuaternion(hud.quaternion);hud.scale.setScalar(1);
}
// Visible day/night grading on the actual panorama canvas, including tiled panoramas.
// Subtle desktop 2.5D movement; GYRO can opt in through phone 3D, but VR
// modes continue using their own tracked head poses without synthetic offsets.
const desktop3DWindow=createDesktop3DWindow(renderer.domElement);
const depthPointer=new THREE.Vector2();
const depthPointerSmooth=new THREE.Vector2();
const depthCameraOffset=new THREE.Vector3();
const depthLocalOffset=new THREE.Vector3();
const depthDesiredOffset=new THREE.Vector3();
let depthAutoPhase=0,depthAutoLastTime=0;
let depthMotionActive=false;
// A drag rotates the panorama; do not add synthetic camera translation to it.
// Reset spring inertia once when a real drag begins (not for hotspot clicks).
function stopDepthTranslationForRotation(){
 depthPointer.set(0,0);depthPointerSmooth.set(0,0);
 depthCameraOffset.set(0,0,0);depthLocalOffset.set(0,0,0);depthDesiredOffset.set(0,0,0);
 desktop3DWindow.reset();
 camera.position.set(0,0,0);
 depthMotionActive=false;
}
renderer.domElement.addEventListener('pointermove',event=>{
 if(mobileMotion.isActive()||(down&&moved))return;
 const bounds=renderer.domElement.getBoundingClientRect();
 if(!bounds.width||!bounds.height)return;
 depthPointer.set(THREE.MathUtils.clamp((event.clientX-bounds.left)/bounds.width*2-1,-1,1),THREE.MathUtils.clamp(1-(event.clientY-bounds.top)/bounds.height*2,-1,1));
});
renderer.domElement.addEventListener('pointerleave',()=>depthPointer.set(0,0));
guidedSetup();
window.addEventListener('pagehide',()=>{panoramaObjectSystem?.dispose();bloomPipeline?.dispose();},{once:true});
renderer.setAnimationLoop((time)=>{
 if(guidedTarget&&getViewerMode()===ViewerMode.DESKTOP&&!orientation){const delta=((guidedTarget.yaw-lon+540)%360)-180;lon+=delta*.045;lat+=(guidedTarget.pitch-lat)*.045;if(Math.abs(delta)<.12&&Math.abs(guidedTarget.pitch-lat)<.12)guidedTarget=null;}
 // GPU-side micro-motion for the nearest depth groups; no CPU texture updates.
 for(const entry of microMotionMaterials)entry.phase.value=time*.001*entry.speed;
 tiledPanorama?.update(time);
 effectSystem?.update(time,camera);atmosphereSystem?.update(time,camera);moonSystem?.update(time,camera);environmentSystem?.update(time,camera);panoramaObjectSystem?.update(time);
 if(getViewerMode()===ViewerMode.DESKTOP&&!down&&!orientation&&effectSettings.rotation){
  const dt=lastEffectTime?Math.min(.05,(time-lastEffectTime)/1000):0;
  const step=dt*Math.max(0,Math.min(10,Number(effectSettings.rotationSpeed)||1));
  if(effectSettings.hideSeamDuringRotation===true&&projection==='360'&&stereoMode==='mono'){
   // SphereGeometry seam is at world longitude 0; auto-rotation moves it left.
   const canvas=renderer.domElement;
   const width=Math.max(1,canvas.clientWidth||canvas.width||1);
   const aspect=width/Math.max(1,canvas.clientHeight||canvas.height||1);
   const halfFov=Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov||75)/2)*aspect);
   const margin=halfFov*(15/width);
   const stopAngle=Math.max(0,halfFov-margin);
   const wrapAngle=a=>THREE.MathUtils.euclideanModulo(a+Math.PI,Math.PI*2)-Math.PI;
   const seam=wrapAngle(THREE.MathUtils.degToRad(-lon));
   if(seamRotationPaused){
    // Resume only after the user changes direction/position or the seam is
    // moved away from the 15px inner stop line.
    if(Math.abs(seam)<stopAngle-THREE.MathUtils.degToRad(.5))seamRotationPaused=false;
   }
   if(!seamRotationPaused&&step>0){
    const nextSeam=wrapAngle(THREE.MathUtils.degToRad(-(lon+step)));
    if(Math.abs(nextSeam)>=stopAngle)seamRotationPaused=true;
    else lon+=step;
   }
  }else{
   seamRotationPaused=false;
   lon+=step;
  }
 }
 lastEffectTime=time;
 const mode=getViewerMode();
 // A panorama without a depth map temporarily suspends the effect; keep the
 // user's 3D choice for the next scene that has a depth map.
 if(mobileMotion.isActive()&&!mobileMotionSensorSupported())stopMobileMotion();
 const stereoPictures=contentGroup.userData.stereoPictures;
 if(stereoPictures){const headset=mode!==ViewerMode.DESKTOP;stereoPictures.desktop.visible=!headset;stereoPictures.leftPic.visible=headset;stereoPictures.rightPic.visible=headset}
 if(mode===ViewerMode.CARDBOARD&&cardboard){const canvas=renderer.domElement;canvas.style.position='fixed';canvas.style.inset='0';canvas.style.width='100vw';canvas.style.height='100dvh';canvas.style.zIndex='1'}
 if(mode===ViewerMode.CARDBOARD&&legacyCardboard){legacyVRControls.update();camera.updateMatrixWorld(true);hud.visible=false}
 syncHudPose();syncCardboardDebug();syncXRDebug();
 scene.traverse(o=>{if(o.userData?.animate)o.userData.animate(time,gazeTarget?.userData?.portal===o||hoveredPortal===o)});
 if(orientation&&(mode===ViewerMode.CARDBOARD||mode===ViewerMode.DESKTOP))deviceOrientation.update();
 // Update motion in view-relative coordinates: when the panorama rotates,
 // the apparent camera translation follows the viewing direction rather
 // than remaining pinned to the world X/Z axes.
 const motionDt=depthAutoLastTime?Math.min(.05,Math.max(0,(time-depthAutoLastTime)/1000)):1/60;
 depthAutoLastTime=time;
 const portraitPhone=window.matchMedia('(orientation: portrait) and (pointer: coarse) and (max-width: 600px)').matches;
 const rotatingView=down&&moved;
 const desktopWindowEligible=mode===ViewerMode.DESKTOP&&!orientation&&!rotatingView&&projection==='360'&&stereoMode==='mono'&&!!parallaxDepthPixels&&effectSettings.parallaxEnabled===true;
 if(mobileMotionEligible()&&mobileMotion.isActive()){
  const tilt=mobileMotion.update(motionDt);
  depthPointer.set(tilt.x*(portraitPhone?.95:.65),tilt.y*(portraitPhone?.75:.5));
 }
 // Mouse dragging rotates the view without simultaneously translating the camera.
 const rotatingPanorama=mode===ViewerMode.DESKTOP&&down&&!orientation;
 const desktopWindowOffset=desktop3DWindow.update(motionDt,desktopWindowEligible&&!rotatingPanorama,depthPointerSmooth);
 if(canTranslateDepthCamera(mode,orientation,mobileMotion.isActive()&&mobileMotionEligible(),rotatingView)){
  // Portrait phone displacement needs more visible screen-space motion.
  // Desktop, landscape, tablets, Cardboard and WebXR remain unchanged.
  const portraitBoost=portraitPhone?1.85:1;
  // Depth Window: optional stronger viewpoint translation, as if looking
  // through a nearby opening into the panorama. No synthetic camera motion in XR.
  const depthWindow=effectSettings.parallaxDepthWindow===true
   ?THREE.MathUtils.clamp(Number(effectSettings.parallaxDepthWindowStrength??50),0,100)/100:0;
  const windowBoost=1+depthWindow*.8;
  const amount=parallaxDepthPixels&&effectSettings.parallaxEnabled
   ? THREE.MathUtils.clamp(Number(effectSettings.parallaxStrength)||0,0,100)/100*portraitBoost*windowBoost:0;
  const autoEnabled=!rotatingPanorama&&!orientation&&amount>0&&effectSettings.rotation&&effectSettings.parallaxAuto!==false;
  const autoAmplitude=THREE.MathUtils.clamp(Number(effectSettings.parallaxAutoAmplitude??35),0,100)/100;
  const autoSpeed=THREE.MathUtils.clamp(Number(effectSettings.parallaxAutoSpeed??.6),.1,3);
  if(autoEnabled)depthAutoPhase=(depthAutoPhase+motionDt*autoSpeed*2*Math.PI/8)%(Math.PI*2);
  const pointerDamping=1-Math.exp(-motionDt*7);
  depthPointerSmooth.lerp(rotatingPanorama?new THREE.Vector2(0,0):depthPointer,pointerDamping);
  // Soft, elliptical translation with small vertical and forward components.
  // Avoid large head bobbing; foreground objects should move more than far ones.
  const sway=autoEnabled?amount*autoAmplitude:0;
  depthLocalOffset.set(
   depthPointerSmooth.x*amount*(desktopReliefEnabled()?.35:1.15)+Math.sin(depthAutoPhase)*sway*.85+desktopWindowOffset.x,
   depthPointerSmooth.y*amount*(desktopReliefEnabled()?.2:(.55+depthWindow*.15))+Math.sin(depthAutoPhase*.65+.4)*sway*.18+desktopWindowOffset.y,
   Math.cos(depthAutoPhase)*sway*.2+depthWindow*amount*.12
  );
  if(portraitPhone&&amount>0){
   // Bounded portrait gain: noticeable near-field motion without crossing
   // the closest (~8-unit) depth shell or opening large disocclusion cracks.
   depthLocalOffset.x=THREE.MathUtils.clamp(depthLocalOffset.x*1.9,-2.1,2.1);
   depthLocalOffset.y=THREE.MathUtils.clamp(depthLocalOffset.y*1.7,-1.3,1.3);
  }
  if(rotatingPanorama)depthLocalOffset.set(0,0,0);
  depthOffsetInWorld(depthLocalOffset,orientation,camera.quaternion,THREE.MathUtils.degToRad(lon),depthDesiredOffset);
  const damping=rotatingPanorama?1:1-Math.exp(-motionDt*8);
  depthCameraOffset.lerp(depthDesiredOffset,damping);
  camera.position.copy(depthCameraOffset);
  depthMotionActive=true;
 }else if(depthMotionActive){
  // Never apply synthetic translation to tracked XR head poses or Cardboard.
  depthCameraOffset.set(0,0,0);depthPointerSmooth.set(0,0);
  if((mode===ViewerMode.CARDBOARD&&!legacyCardboard)||(mode===ViewerMode.DESKTOP&&orientation))camera.position.set(0,0,0);
  depthMotionActive=false;
 }
 if(mode===ViewerMode.DESKTOP&&!orientation){const phi=THREE.MathUtils.degToRad(90-lat),theta=THREE.MathUtils.degToRad(lon);camera.lookAt(500*Math.sin(phi)*Math.cos(theta),500*Math.cos(phi),500*Math.sin(phi)*Math.sin(theta))}
 if(mode===ViewerMode.WEBXR){syncXREyes();updateGaze();renderer.render(scene,camera);return}
 if(mode===ViewerMode.CARDBOARD){updateCardboardGaze();if(legacyCardboard)legacyVREffect.render(scene,camera);else renderCardboard();return}
 if(bloomStrength>0&&mode===ViewerMode.DESKTOP&&!orientation)bloomPipeline?.render(scene,camera,bloomStrength);else renderer.render(scene,camera);
});
setTimeout(()=>document.querySelector('#viewer-help')?.classList.add('hide'),4200);
