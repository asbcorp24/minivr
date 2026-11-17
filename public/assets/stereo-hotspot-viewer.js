(()=>{
'use strict';
let overlay=null,frame=0,source=null,mode='pro',format='sbs',eye=0,run=false,last=0,pro=null,loadId=0;
function close(){loadId++;run=false;cancelAnimationFrame(frame);pro?.dispose();pro=null;overlay?.remove();overlay=null;source=null;document.removeEventListener('keydown',key)}
function key(e){if(e.key==='Escape')close();else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){eye=e.key==='ArrowLeft'?0:1;draw()}}
function eyeRect(index){const w=source.naturalWidth,h=source.naturalHeight;return format==='sbs'?{sx:index*w/2,sy:0,sw:w/2,sh:h}:{sx:0,sy:index*h/2,sw:w,sh:h/2}}
function draw(){if(!overlay||!source||mode==='pro')return;const canvas=overlay.querySelector('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:mode==='anaglyph'}),rect=eyeRect(0),ratio=rect.sw/rect.sh;const availableW=Math.max(1,window.innerWidth-32),availableH=Math.max(1,window.innerHeight-150);let w=Math.min(availableW,availableH*ratio),h=w/ratio;const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);canvas.style.width=w+'px';canvas.style.height=h+'px';ctx.imageSmoothingEnabled=true;
if(mode==='pair'){const first=eyeRect(0),second=eyeRect(1);canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);ctx.drawImage(source,first.sx,first.sy,first.sw,first.sh,0,0,canvas.width/2,canvas.height);ctx.drawImage(source,second.sx,second.sy,second.sw,second.sh,canvas.width/2,0,canvas.width/2,canvas.height);return}
if(mode==='anaglyph'){
const left=document.createElement('canvas');left.width=canvas.width;left.height=canvas.height;const lc=left.getContext('2d',{willReadFrequently:true});lc.drawImage(source,...Object.values(eyeRect(0)),0,0,left.width,left.height);
const right=document.createElement('canvas');right.width=canvas.width;right.height=canvas.height;const rc=right.getContext('2d',{willReadFrequently:true});rc.drawImage(source,...Object.values(eyeRect(1)),0,0,right.width,right.height);
const l=lc.getImageData(0,0,left.width,left.height),r=rc.getImageData(0,0,right.width,right.height);for(let i=0;i<l.data.length;i+=4){l.data[i+1]=r.data[i+1];l.data[i+2]=r.data[i+2]}ctx.putImageData(l,0,0);return}
const crop=eyeRect(eye);ctx.drawImage(source,crop.sx,crop.sy,crop.sw,crop.sh,0,0,canvas.width,canvas.height);
}
function tick(t){if(!run)return;if(mode==='wiggle'&&t-last>460){eye=1-eye;draw();last=t}frame=requestAnimationFrame(tick)}
async function activateMode(next){
  mode=next;pro?.dispose();pro=null;
  if(!overlay||!source)return;
  const previous=overlay.querySelector('canvas');const canvas=document.createElement('canvas');canvas.style.cssText=previous.style.cssText;previous.replaceWith(canvas);const hint=overlay.querySelector('[data-hint]');
  overlay.querySelectorAll('[data-mode]').forEach(x=>x.style.background=x.dataset.mode===mode?'#137b92':'#123342');
  if(mode==='pro'){
    hint.textContent='Живое 3D Pro · глубина из SBS/TB, управление мышью · сила 35%, плавность 75%.';
    const token=++loadId;
    try{
      const module=await import('/assets/stereo-depth-3d-pro.js');
      if(token!==loadId||!overlay||mode!=='pro')return;
      pro=module.createStereo3DPro(canvas,source,format,{strength:35,smoothness:75});
    }catch(error){
      console.error('Stereo 3D Pro unavailable:',error);
      hint.textContent='Не удалось построить глубину или запустить WebGL. Открыт обычный ракурс.';
      activateMode('wiggle');
    }
  }else{
    ++loadId;
    hint.textContent=mode==='anaglyph'?'Анаглиф: нужны красно-голубые очки.':mode==='wiggle'?'Попеременные ракурсы без очков.':'Исходная стереопара.';
    draw();
  }
}
window.openMiniVRStereoPhoto=(url,stereo,title)=>{
if(!['sbs','tb'].includes(stereo))return;close();format=stereo;mode='pro';eye=0;last=0;
overlay=document.createElement('div');overlay.setAttribute('role','dialog');overlay.setAttribute('aria-modal','true');overlay.setAttribute('aria-label','Стереофото: '+(title||''));overlay.style.cssText='position:fixed;inset:0;z-index:99999;background:#020b11f7;color:#e7fbff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:12px;box-sizing:border-box';
const bar=document.createElement('div');bar.style.cssText='display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:9px';
const name=document.createElement('strong');name.textContent=title||'Стереофото';bar.append(name);
for(const [id,label] of [['pro','Живое 3D Pro'],['wiggle','Живое 3D (старое)'],['anaglyph','Анаглиф'],['pair','Два ракурса']]){const b=document.createElement('button');b.type='button';b.textContent=label;b.dataset.mode=id;b.onclick=()=>activateMode(id);b.style.cssText='padding:10px;border:1px solid #54d5e9;color:white;background:'+(id===mode?'#137b92':'#123342');bar.append(b)}
const exit=document.createElement('button');exit.type='button';exit.textContent='✕ Закрыть';exit.style.cssText='padding:10px;background:#123342;color:white;border:1px solid #54d5e9';exit.onclick=close;bar.append(exit);
const canvas=document.createElement('canvas');canvas.style.cssText='display:block;max-width:100%;max-height:calc(100vh - 160px);object-fit:contain;touch-action:none';
const hint=document.createElement('small');hint.dataset.hint='';hint.style.cssText='color:#a6c8d2;text-align:center';hint.textContent='Восстановление глубины из стереопары…';
overlay.append(bar,canvas,hint);document.body.append(overlay);document.addEventListener('keydown',key);
const img=new Image();img.onload=()=>{if(!overlay)return;source=img;activateMode('pro');run=true;frame=requestAnimationFrame(tick)};img.onerror=()=>{hint.textContent='Не удалось загрузить стереофото'};img.src=url;
};
})();