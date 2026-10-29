(()=>{'use strict';
const form=document.querySelector('#effect-map')?.closest('form');if(!form)return;
const get=n=>form.elements.namedItem(n),checked=n=>!!get(n)?.checked,select=n=>get(n)?.value;
const show=(n,yes)=>{const el=get(n);if(!el)return;const label=el.closest('label');if(label){label.hidden=!yes;label.style.display=yes?'':'none'}};
const map=document.querySelector('#effect-map')?.parentElement;
const mode=document.querySelector('#effect-map-mode');
const undo=document.querySelector('#effect-map-undo'),clear=document.querySelector('#effect-map-clear');
const groups={
 rotation:['rotationSpeed'],
 fog:['fogDensity','fogHeight'],
 storm:['stormIntensity'],
 sunRays:['sunIntensity','sunYaw','sunPitch'],
 moon:['moonYaw','moonPitch','moonIntensity'],
 fireflies:['fireflyDensity'],
 moonPath:['moonPathWidth','moonHorizon','moonBottom']
};
function refresh(){
 for(const [key,fields] of Object.entries(groups)){
  const enabled=checked(key)&&(key!=='moonPath'||checked('moon'));
  for(const name of fields)show(name,enabled);
 }
 const particles=select('particles')!=='none';
 for(const n of ['density','speed','wind','opacity'])show(n,particles);
 show('moonPath',checked('moon'));
 const waterActive=checked('moon')&&checked('moonPath'),moonActive=checked('moon'),sunActive=checked('sunRays');
 const tool=mode?.value||'water';
 const tools=mode?.options||[];
 for(const option of tools){option.disabled=(option.value==='sun'&&!sunActive)||(option.value==='moon'&&!moonActive)||(option.value==='polygon'&&!waterActive)}
 if(mode?.selectedOptions[0]?.disabled){const available=Array.from(tools).find(o=>!o.disabled);if(available)mode.value=available.value}
 const anyTool=sunActive||moonActive||waterActive;
 if(map)map.hidden=!anyTool;
 if(map)map.style.display=anyTool?'':'none';
 const polygon=mode?.value==='polygon';
 if(undo){undo.hidden=!polygon;undo.style.display=polygon?'':'none'}
 if(clear){clear.hidden=!polygon;clear.style.display=polygon?'':'none'}
 const hint=document.querySelector('#effect-map-hint');if(hint&&anyTool)hint.textContent=polygon?'Контур воды: нажимайте на границу, минимум 3 точки.':'Нажмите на панораму для установки положения. Для круга воды потяните для изменения радиуса.';
}
form.addEventListener('change',refresh);
form.addEventListener('input',e=>{if(e.target.type==='checkbox'||e.target.name==='particles')refresh()});
refresh();
})();