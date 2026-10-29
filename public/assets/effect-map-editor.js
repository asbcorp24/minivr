(()=>{'use strict';
const canvas=document.getElementById('effect-map'),form=canvas?.closest('form');if(!canvas||!form)return;
const ctx=canvas.getContext('2d'),mode=document.getElementById('effect-map-mode'),hint=document.getElementById('effect-map-hint');
const names={sun:['sunYaw','sunPitch'],water:['waterYaw','waterPitch']};
const field=name=>form.elements.namedItem(name);
const number=name=>Number(field(name)?.value)||0;
const set=(name,value)=>{if(field(name)){field(name).value=String(Math.round(value*10)/10);field(name).dispatchEvent(new Event('change',{bubbles:true}))}};
let image=new Image(),loaded=false,dragging=false,anchor=null;
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
 marker(number('sunYaw'),number('sunPitch'),'#ffd66a','☀ Солнце');
 marker(number('waterYaw'),number('waterPitch'),'#55c9ff','◉ Вода',number('waterRadius'));
}
function apply(e){
 const p=read(e),kind=mode.value,[yaw,pitch]=names[kind];set(yaw,p.yaw);set(pitch,p.pitch);
 if(kind==='water'&&dragging&&anchor){
  const a=THREELESS(angle(anchor.yaw),angle(anchor.pitch)),b=THREELESS(angle(p.yaw),angle(p.pitch));
  const dot=Math.sin(a[1])*Math.sin(b[1])+Math.cos(a[1])*Math.cos(b[1])*Math.cos(a[0]-b[0]);
  set('waterRadius',Math.max(2,Math.min(70,Math.acos(Math.max(-1,Math.min(1,dot)))*180/Math.PI)));
 }
 draw();
}
const angle=v=>v*Math.PI/180,THREELESS=(a,b)=>[a,b];
canvas.addEventListener('pointerdown',e=>{dragging=true;anchor=read(e);canvas.setPointerCapture(e.pointerId);apply(e)});
canvas.addEventListener('pointermove',e=>{if(dragging)apply(e)});
const finish=()=>{dragging=false;anchor=null};canvas.addEventListener('pointerup',finish);canvas.addEventListener('pointercancel',finish);
form.addEventListener('input',e=>{if(['sunYaw','sunPitch','waterYaw','waterPitch','waterRadius'].includes(e.target.name))draw()});
document.getElementById('effect-map-file')?.addEventListener('change',e=>{const file=e.target.files?.[0];if(!file)return;const url=URL.createObjectURL(file);image.onload=()=>{loaded=true;draw();URL.revokeObjectURL(url)};image.src=url});
if(canvas.dataset.src){image.onload=()=>{loaded=true;draw()};image.onerror=()=>{hint.textContent='Предпросмотр недоступен: выберите изображение для отображения.'};image.src=canvas.dataset.src}
hint.textContent='Нажмите для размещения. Для воды: нажмите на центр и протяните для задания радиуса. Изображение показано в развёртке 360°.';
draw();
})();