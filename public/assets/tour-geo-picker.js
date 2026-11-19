// Admin tour scene map picker. Leaflet is bundled locally; only map tiles are
// requested from OpenStreetMap, and only when the editor is opened.
(() => {
 'use strict';
 const dialog=document.querySelector('#tour-geo-picker-dialog');
 if(!dialog)return;
 const closeButton=dialog.querySelector('#tour-geo-picker-close');
 const cancelButton=dialog.querySelector('#tour-geo-picker-cancel');
 const applyButton=dialog.querySelector('#tour-geo-picker-apply');
 const centerButton=dialog.querySelector('#tour-geo-picker-center');
 const nearButton=dialog.querySelector('#tour-geo-picker-near');
 const coordinateOutput=dialog.querySelector('#tour-geo-picker-coordinates');
 const scopes=Array.from(document.querySelectorAll('[data-tour-geo-scope]'));
 let map=null,marker=null,candidate=null,activeScope=null,returnFocus=null;

 function savedPoint(scope){
  const latText=scope.querySelector('[name="geo_lat"]')?.value.trim()||'';
  const lngText=scope.querySelector('[name="geo_lng"]')?.value.trim()||'';
  if(!latText||!lngText)return null;
  const lat=Number(latText),lng=Number(lngText);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180?{lat,lng}:null;
 }
 function mapUrl(point){
  return 'https://www.openstreetmap.org/?'+new URLSearchParams({mlat:String(point.lat),mlon:String(point.lng)})+'#map=16/'+point.lat+'/'+point.lng;
 }
 function updateSceneLocation(scope){
  const point=savedPoint(scope);
  const output=scope.querySelector('[data-tour-geo-status]');
  const view=scope.querySelector('[data-tour-geo-view]');
  const clear=scope.querySelector('[data-tour-geo-clear]');
  output.textContent=point?point.lat.toFixed(6)+'°, '+point.lng.toFixed(6)+'°':'Место ещё не указано';
  view.hidden=!point;
  if(point)view.href=mapUrl(point);
  clear.disabled=!point;
 }
 function setCandidate(position){
  const lat=Number(Number(position.lat).toFixed(6));
  const lng=Number(Number(position.lng).toFixed(6));
  if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)return;
  candidate={lat,lng};
  if(!marker){
   marker=L.marker([lat,lng],{draggable:true,autoPan:true}).addTo(map);
   marker.on('dragend',()=>setCandidate(marker.getLatLng()));
  }else marker.setLatLng([lat,lng]);
  coordinateOutput.textContent='Выбрано: '+lat.toFixed(6)+'°, '+lng.toFixed(6)+'°';
  applyButton.disabled=false;
 }
 function ensureMap(){
  if(map)return true;
  if(!window.L){coordinateOutput.textContent='Не удалось загрузить карту. Проверьте подключение к сайту.';return false}
  const initial=scopes.map(savedPoint).find(Boolean);
  map=L.map('tour-geo-picker-map',{worldCopyJump:true}).setView(initial?[initial.lat,initial.lng]:[20,0],initial?12:2);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{
   maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
  }).addTo(map);
  map.on('click',event=>setCandidate(event.latlng));
  return true;
 }
 function openPicker(scope,button){
  activeScope=scope;returnFocus=button;
  dialog.hidden=false;
  document.body.classList.add('tour-geo-picker-open');
  candidate=null;applyButton.disabled=true;
  coordinateOutput.textContent='Нажмите на карту, чтобы поставить точку';
  if(ensureMap()){
   const existing=savedPoint(scope);
   if(marker){map.removeLayer(marker);marker=null}
   if(existing){map.setView([existing.lat,existing.lng],15);setCandidate(existing)}
   requestAnimationFrame(()=>map.invalidateSize());
  }
  closeButton.focus();
 }
 function closePicker(){
  dialog.hidden=true;
  document.body.classList.remove('tour-geo-picker-open');
  activeScope=null;candidate=null;
  returnFocus?.focus();returnFocus=null;
 }
 function applyPoint(){
  if(!activeScope||!candidate)return;
  activeScope.querySelector('[name="geo_lat"]').value=String(candidate.lat);
  activeScope.querySelector('[name="geo_lng"]').value=String(candidate.lng);
  updateSceneLocation(activeScope);
  closePicker();
 }

 for(const scope of scopes){
  updateSceneLocation(scope);
  const button=scope.querySelector('[data-tour-geo-open]');
  button.addEventListener('click',()=>openPicker(scope,button));
  scope.querySelector('[data-tour-geo-clear]').addEventListener('click',()=>{
   scope.querySelector('[name="geo_lat"]').value='';
   scope.querySelector('[name="geo_lng"]').value='';
   updateSceneLocation(scope);
  });
 }
 closeButton.addEventListener('click',closePicker);
 cancelButton.addEventListener('click',closePicker);
 applyButton.addEventListener('click',applyPoint);
 centerButton.addEventListener('click',()=>{if(map)setCandidate(map.getCenter())});
 nearButton.addEventListener('click',()=>{
  if(!map||!navigator.geolocation){coordinateOutput.textContent='Геолокация устройства недоступна';return}
  coordinateOutput.textContent='Определяем положение устройства…';
  navigator.geolocation.getCurrentPosition(({coords})=>{
   if(dialog.hidden)return;
   map.setView([coords.latitude,coords.longitude],16);
   setCandidate({lat:coords.latitude,lng:coords.longitude});
  },()=>{if(!dialog.hidden)coordinateOutput.textContent='Не удалось определить местоположение. Выберите точку на карте.'},{enableHighAccuracy:true,timeout:10000,maximumAge:60000});
 });
 dialog.addEventListener('click',event=>{if(event.target===dialog)closePicker()});
 document.addEventListener('keydown',event=>{
  if(dialog.hidden)return;
  if(event.key==='Escape'){event.preventDefault();closePicker();return}
  if(event.key!=='Tab')return;
  const focusables=Array.from(dialog.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled])')).filter(el=>el.getClientRects().length>0);
  if(!focusables.length)return;
  const first=focusables[0],last=focusables[focusables.length-1];
  if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
  else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
 });
})();
