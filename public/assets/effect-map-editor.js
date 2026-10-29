(()=>{'use strict';
const canvas=document.getElementById('effect-map'),form=canvas?.closest('form');if(!canvas||!form)return;
const ctx=canvas.getContext('2d'),mode=document.getElementById('effect-map-mode'),hint=document.getElementById('effect-map-hint');
const names={sun:['sunYaw','sunPitch'],moon:['moonYaw','moonPitch']};
const field=name=>form.elements.namedItem(name);
const number=name=>Number(field(name)?.value)||0;
const set=(name,value)=>{if(field(name)){field(name).value=String(Math.round(value*10)/10);field(name).dispatchEvent(new Event('change',{bubbles:true}))}};
let image=new Image(),loaded=false,dragging=false,anchor=null;
const masksField=field('effectMasks'),lampsField=field('effectLamps');
let masks={water:[],sky:[],light:[],vegetation:[]},lamps=[];try{Object.assign(masks,JSON.parse(masksField?.value||'{}'));lamps=JSON.parse(lampsField?.value||'[]')}catch(_){}
const saveLayers=()=>{if(masksField)masksField.value=JSON.stringify(masks);if(lampsField)lampsField.value=JSON.stringify(lamps)};
const current=()=>mode.value.startsWith('mask-')?masks[mode.value.slice(5)]:mode.value==='lamp'?lamps:polygon;
const polygonField=field('waterPolygon');let polygon=[];try{const parsed=JSON.parse(polygonField?.value||'[]');if(Array.isArray(parsed))polygon=parsed.filter(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)).slice(0,80)}catch(_){}
const savePolygon=()=>{if(polygonField)polygonField.value=JSON.stringify(polygon)};
document.getElementById('effect-map-undo')?.addEventListener('click',()=>{current().pop();savePolygon();saveLayers();draw()});
document.getElementById('effect-map-clear')?.addEventListener('click',()=>{if(mode.value==='polygon')polygon=[];else if(mode.value==='lamp')lamps=[];else if(mode.value.startsWith('mask-'))masks[mode.value.slice(5)]=[];savePolygon();saveLayers();draw()});

const normalize=(yaw,pitch)=>({x:(yaw+180)/360*canvas.width,y:(90-pitch)/180*canvas.height});
const read=(e)=>{const rect=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(e.clientY-rect.top)/rect.height));return {yaw:x*360-180,pitch:90-y*180}};
const marker=(yaw,pitch,color,label,radius=0)=>{
 const p=normalize(yaw,pitch);ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;ctx.beginPath();ctx.arc(p.x,p.y,6,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#10202a';ctx.stroke();
 ctx.font='bold 14px system-ui';ctx.fillStyle='#fff';ctx.fillText(label,Math.min(canvas.width-110,p.x+12),Math.max(18,p.y-10));
 if(radius>0){const ry=radius/180*canvas.height,rx=radius/360*canvas.width;ctx.setLineDash([7,5]);ctx.strokeStyle=color;ctx.lineWidth=2;for(const offset of [-canvas.width,0,canvas.width]){ctx.beginPath();ctx.ellipse(p.x+offset,p.y,rx,ry,0,0,Math.PI*2);ctx.stroke()}ctx.setLineDash([])}
};
function draw(){
 ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#14232b';ctx.fillRect(0,0,canvas.width,canvas.height);
 if(loaded)ctx.drawImage(image,0,0,canvas.width,canvas.height);
 ctx.fillStyle='rgba(0,0,0,.08)';ctx.fillRect(0,0,canvas.width,canvas.height);
 ctx.strokeStyle='rgba(255,255,255,.28)';ctx.lineWidth=1;
 for(let i=1;i<6;i++){ctx.beginPath();ctx.moveTo(i*canvas.width/6,0);ctx.lineTo(i*canvas.width/6,canvas.height);ctx.stroke()}
 for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,i*canvas.height/4);ctx.lineTo(canvas.width,i*canvas.height/4);ctx.stroke()}
 if(polygon.length){ctx.save();ctx.beginPath();polygon.forEach((p,i)=>{const xy=normalize(p[0],p[1]);if(i===0)ctx.moveTo(xy.x,xy.y);else ctx.lineTo(xy.x,xy.y)});if(polygon.length>=3){ctx.closePath();ctx.fillStyle='rgba(64,190,255,.25)';ctx.fill()}ctx.strokeStyle='#36caff';ctx.lineWidth=3;ctx.stroke();for(const p of polygon){const xy=normalize(p[0],p[1]);ctx.beginPath();ctx.arc(xy.x,xy.y,4,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill()}ctx.restore()}
 for(const [name,points] of Object.entries(masks)){
  if(!Array.isArray(points)||!points.length)continue;
  const colors={water:'#4cc9ff',sky:'#a6d2ff',light:'#ffd178',vegetation:'#8ce3a1'};
  ctx.save();ctx.beginPath();points.forEach((p,i)=>{const xy=normalize(p[0],p[1]);if(i)ctx.lineTo(xy.x,xy.y);else ctx.moveTo(xy.x,xy.y)});
  if(points.length>=3){ctx.closePath();ctx.fillStyle=({water:'rgba(76,201,255,.22)',sky:'rgba(166,210,255,.18)',light:'rgba(255,209,120,.22)',vegetation:'rgba(140,227,161,.20)'})[name];ctx.fill()}
  ctx.strokeStyle=colors[name];ctx.lineWidth=2;ctx.stroke();ctx.restore();
 }
 for(const [yaw,pitch] of lamps)marker(yaw,pitch,'#ffca76','✦ Фонарь');
 marker(number('moonYaw'),number('moonPitch'),'#d5e5ff','☾ Луна');
 marker(number('sunYaw'),number('sunPitch'),'#ffd66a','☀ Солнце');

}
function apply(e){
 const p=read(e),kind=mode.value,[yaw,pitch]=names[kind];if(yaw&&pitch){set(yaw,p.yaw);set(pitch,p.pitch)}

 draw();
}
const angle=v=>v*Math.PI/180;
canvas.addEventListener('pointerdown',e=>{if(mode.value==='polygon'||mode.value.startsWith('mask-')||mode.value==='lamp'){const points=current();if(points.length<(mode.value==='lamp'?20:80)){const p=read(e);points.push([Math.round(p.yaw*10)/10,Math.round(p.pitch*10)/10]);savePolygon();saveLayers();draw()}return}dragging=true;anchor=read(e);canvas.setPointerCapture(e.pointerId);const [yaw,pitch]=names[mode.value];set(yaw,anchor.yaw);set(pitch,anchor.pitch);draw()});
canvas.addEventListener('pointermove',e=>{if(dragging&&mode.value!=='polygon')apply(e)});
const finish=()=>{dragging=false;anchor=null};canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
form.addEventListener('input',e=>{if(['sunYaw','sunPitch','moonYaw','moonPitch'].includes(e.target.name))draw()});
document.getElementById('effect-map-file')?.addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;const url=URL.createObjectURL(file);image.onload=()=>{loaded=true;draw();URL.revokeObjectURL(url)};image.src=url});
if(canvas.dataset.src){image.onload=()=>{loaded=true;draw()};image.onerror=()=>{hint.textContent='Предпросмотр недоступен: выберите изображение для отображения.'};image.src=canvas.dataset.src}
hint.textContent='Выберите слой: контуры рисуются точками (от 3 вершин), фонари добавляются одиночными точками. Отмена и очистка работают с выбранным слоем.';
draw();
})();