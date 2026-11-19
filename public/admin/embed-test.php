<?php
declare(strict_types=1);
session_start();
if (empty($_SESSION['admin'])) {
    header('Location: /admin/');
    exit;
}
header('Cache-Control: private, no-store');
header('Referrer-Policy: no-referrer');
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Проверка iframe — MiniVR</title>
<style>
:root{color-scheme:dark;font-family:system-ui,sans-serif;background:#07131e;color:#e9f8fc}
*{box-sizing:border-box}body{margin:0;padding:clamp(16px,3vw,36px);max-width:1350px;margin-inline:auto}
a{color:#7be4ee}h1{margin:.3em 0}p{color:#a6c5d0;line-height:1.55}
.panel{background:#102533;border:1px solid #315666;border-radius:14px;padding:18px;margin:18px 0}
label{display:block;font-weight:600;margin-bottom:8px}
input,textarea{width:100%;padding:12px;background:#071923;color:#eafcff;border:1px solid #507485;border-radius:8px;font:inherit}
textarea{resize:vertical;min-height:95px}button{background:#117b89;color:white;border:1px solid #51c3d0;border-radius:8px;padding:11px 17px;cursor:pointer;font-weight:700}
button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid #92ecf5;outline-offset:3px}
.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;align-items:center}
.preview{width:100%;height:clamp(360px,62vh,760px);border:1px solid #4a8190;border-radius:10px;background:#030b11}
.small{font-size:.85rem}code{overflow-wrap:anywhere}
</style>
</head>
<body>
<a href="/admin/embeds.php">← Назад к токенам встраивания</a>
<h1>Проверка встраивания MiniVR</h1>
<p>Это тестовая страница на том же сайте. Сначала создайте токен в админке, затем вставьте ссылку или полный HTML-код iframe ниже. После проверки попробуйте тот же код на другом домене.</p>
<section class="panel">
<label for="embed-source">Ссылка вида /embed.php?token=… или HTML iframe</label>
<textarea id="embed-source" spellcheck="false" autocomplete="off" placeholder="Вставьте ссылку или готовый iframe из админки"></textarea>
<div class="actions"><button id="show" type="button">Показать встраивание</button><button id="clear" type="button">Очистить</button><span id="status" role="status" aria-live="polite"></span></div>
<p class="small">Токен используется только в вашем браузере. Страница не сохраняет его и не передаёт сторонним сервисам.</p>
</section>
<section class="panel">
<h2>Предпросмотр iframe</h2>
<div id="preview"><p>Вставьте код выше и нажмите «Показать встраивание».</p></div>
</section>
<script>
(()=>{
'use strict';
const source=document.getElementById('embed-source');
const preview=document.getElementById('preview');
const status=document.getElementById('status');
function extractUrl(value){
  const input=value.trim();
  if(!input)return null;
  let candidate=input;
  if(input.startsWith('<')){
    const doc=new DOMParser().parseFromString(input,'text/html');
    const frames=doc.querySelectorAll('iframe');
    if(frames.length!==1)return null;
    candidate=frames[0].getAttribute('src')||'';
  }
  try{
    const url=new URL(candidate,location.origin);
    if(url.origin!==location.origin||url.pathname!=='/embed.php')return null;
    if(!/^[a-f0-9]{48}$/.test(url.searchParams.get('token')||''))return null;
    if([...url.searchParams.keys()].some(key=>key!=='token'))return null;
    return url.href;
  }catch{return null}
}
document.getElementById('show').addEventListener('click',()=>{
  const url=extractUrl(source.value);
  preview.replaceChildren();
  if(!url){
    status.textContent='Нужна корректная ссылка MiniVR /embed.php с токеном.';
    return;
  }
  const iframe=document.createElement('iframe');
  iframe.className='preview';
  iframe.title='Предпросмотр панорамы или экскурсии MiniVR';
  iframe.src=url;
  iframe.allow='fullscreen; accelerometer; gyroscope; xr-spatial-tracking';
  iframe.setAttribute('allowfullscreen','');
  iframe.referrerPolicy='no-referrer';
  preview.append(iframe);
  status.textContent='Предпросмотр открыт. Если доступ отозван, внутри появится сообщение об ошибке.';
});
document.getElementById('clear').addEventListener('click',()=>{
  source.value='';preview.replaceChildren();status.textContent='Очищено.';
});
})();
</script>
</body>
</html>
