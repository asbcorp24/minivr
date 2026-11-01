// MiniVR install prompt and new panorama announcements.
if('serviceWorker' in navigator&&location.protocol==='https:'){
 window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).catch(err=>console.warn('MiniVR PWA:',err)));
}
(()=>{
 const installed=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
 const css=document.createElement('style');
 css.textContent=`.minivr-toast{position:fixed;z-index:2147483000;bottom:22px;left:50%;transform:translateX(-50%);width:min(430px,calc(100vw - 28px));box-sizing:border-box;background:rgba(9,21,34,.97);color:#f4fbff;border:1px solid #43829a;border-radius:18px;padding:17px;box-shadow:0 15px 45px #0009;font:14px/1.5 system-ui,sans-serif;backdrop-filter:blur(14px)}.minivr-toast strong{display:block;font-size:16px;margin-bottom:5px}.minivr-toast p{margin:0 0 12px;color:#bed4df}.minivr-toast-actions{display:flex;gap:9px;flex-wrap:wrap}.minivr-toast button,.minivr-toast a{cursor:pointer;border-radius:10px;padding:9px 13px;border:1px solid #4d879b;color:white;background:#123d50;text-decoration:none;font:inherit}.minivr-toast .primary{background:#00a7c8;border-color:#00a7c8;color:#00171e;font-weight:700}.minivr-toast button:focus-visible,.minivr-toast a:focus-visible{outline:2px solid white}`;
 document.head.appendChild(css);
 let current=null,installEvent=null;
 const queue=[];
 function next(){
  if(current||!queue.length)return;
  const item=queue.shift();current=document.createElement('aside');current.className='minivr-toast';current.setAttribute('role','status');
  const title=document.createElement('strong');title.textContent=item.title;current.appendChild(title);
  const body=document.createElement('p');body.textContent=item.message;current.appendChild(body);
  const actions=document.createElement('div');actions.className='minivr-toast-actions';current.appendChild(actions);
  for(const action of item.actions){
   const el=document.createElement(action.href?'a':'button');
   el.textContent=action.label;if(action.href)el.href=action.href;else el.type='button';
   if(action.primary)el.className='primary';
   el.addEventListener('click',()=>{action.run?.();close();});
   actions.appendChild(el);
  }
  document.body.appendChild(current);
 }
 function close(){current?.remove();current=null;next();}
 function show(item){queue.push(item);next();}
 function promptInstall(){
  if(installed()||sessionStorage.getItem('minivr-install-dismissed')==='1')return;
  if(localStorage.getItem('minivr-install-dismissed-until')>Date.now())return;
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent);
  if(!installEvent&&!ios)return;
  show({title:'Установить MiniVR',message:ios?'Откройте меню «Поделиться» в Safari и выберите «На экран Домой».':'Добавьте MiniVR на главный экран для быстрого доступа к панорамам и экскурсиям.',actions:[
   ...(!ios&&installEvent?[{label:'Установить',primary:true,run:async()=>{const e=installEvent;installEvent=null;try{await e.prompt();const choice=await e.userChoice;if(choice?.outcome==='dismissed')localStorage.setItem('minivr-install-dismissed-until',String(Date.now()+7*86400000));}catch(err){console.warn('PWA install:',err)}}}]:[]),
   {label:'Позже',run:()=>{sessionStorage.setItem('minivr-install-dismissed','1');localStorage.setItem('minivr-install-dismissed-until',String(Date.now()+7*86400000));}}
  ]});
 }
 window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;promptInstall();});
 window.addEventListener('appinstalled',()=>{installEvent=null;localStorage.removeItem('minivr-install-dismissed-until');});
 if(/iPad|iPhone|iPod/.test(navigator.userAgent))window.addEventListener('load',()=>setTimeout(promptInstall,2500));

 // Background push is opt-in and requires VAPID server configuration.
 async function enablePush(){
  const config=await fetch('/push.php',{cache:'no-store'}).then(r=>r.json());
  if(!config.publicKey)throw Error('Push is not configured on the server');
  const permission=await Notification.requestPermission();
  if(permission!=='granted')return;
  const registration=await navigator.serviceWorker.ready;
  const b64=config.publicKey.replace(/-/g,'+').replace(/_/g,'/');
  const bytes=Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length/4)*4,'=')),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
  const saved=await fetch('/push.php',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(subscription)});
  if(!saved.ok)throw Error('Subscription could not be saved');
  localStorage.setItem('minivr-push-opt-in','1');
 }
 if('PushManager' in window&&'Notification' in window&&'serviceWorker' in navigator){
  window.addEventListener('load',async()=>{
   if(Notification.permission==='denied'||localStorage.getItem('minivr-push-opt-in'))return;
   try{
    const cfg=await fetch('/push.php',{cache:'no-store'}).then(r=>r.json());
    if(!cfg.publicKey)return;
    setTimeout(()=>show({title:'Уведомления о новых панорамах',message:'Разрешить MiniVR присылать новости, даже когда приложение закрыто?',actions:[
     {label:'Включить',primary:true,run:()=>enablePush().catch(err=>console.warn('MiniVR push:',err))},
     {label:'Не сейчас',run:()=>localStorage.setItem('minivr-push-opt-in','later')}
    ]}),5000);
   }catch{}
  });
 }

 // In-app announcements work independently of Web Push.
 const seenKey='minivr-known-panoramas-v1';
 async function checkNew(){
  if(document.visibilityState==='hidden')return;
  try{
   const response=await fetch('/panorama-updates.php',{cache:'no-store'});
   if(!response.ok)return;
   const data=await response.json();
   if(!Array.isArray(data.panoramas))return;
   const latest=data.panoramas.filter(p=>Number.isSafeInteger(Number(p.id))&&Number(p.id)>0);
   const ids=latest.map(p=>String(p.id));
   const previous=localStorage.getItem(seenKey);
   if(previous===null){localStorage.setItem(seenKey,JSON.stringify(ids));return;}
   let known=[];try{known=JSON.parse(previous)}catch{}
   const unseen=latest.filter(p=>!known.includes(String(p.id)));
   localStorage.setItem(seenKey,JSON.stringify([...new Set([...ids,...known])].slice(0,200)));
   if(!unseen.length)return;
   const newest=unseen[0];
   show({title:unseen.length===1?'Новая панорама!':`Новые панорамы: ${unseen.length}`,message:unseen.length===1?String(newest.title):`Добавлены новые материалы. Последняя: ${newest.title}`,actions:[
    {label:'Посмотреть',href:'/viewer.php?id='+encodeURIComponent(newest.id),primary:true},
    {label:'Закрыть'}
   ]});
  }catch(err){console.warn('MiniVR updates:',err);}
 }
 window.addEventListener('load',()=>{setTimeout(checkNew,1200);setInterval(checkNew,120000);});
 document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')checkNew();});
})();
