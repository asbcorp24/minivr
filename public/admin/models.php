<?php
declare(strict_types=1);
session_start();
require_once __DIR__.'/../../src/db.php';
require_once __DIR__.'/../../src/ai-models.php';
if(!($_SESSION['admin']??false)){http_response_code(403);exit('Доступ запрещён');}
if(empty($_SESSION['models_csrf']))$_SESSION['models_csrf']=bin2hex(random_bytes(32));
$registry=miniVrAiModelRegistry();$message='';$error='';
if($_SERVER['REQUEST_METHOD']==='POST'){
 if(!hash_equals($_SESSION['models_csrf'],(string)($_POST['csrf']??''))){http_response_code(403);exit('Неверный защитный токен');}
 try{
  $id=(string)($_POST['model_id']??'');$action=(string)($_POST['action']??'');
  if(!isset($registry[$id]))throw new RuntimeException('Модель отсутствует в реестре');
  if($action==='install'){miniVrAiInstallModel($registry[$id]);$message='Модель «'.$registry[$id]['name'].'» установлена.';}
  elseif($action==='delete'){miniVrAiDeleteModel($registry[$id]);$message='Модель «'.$registry[$id]['name'].'» удалена.';}
  else throw new RuntimeException('Неизвестная команда');
 }catch(Throwable $e){$error=$e->getMessage();}
}
$models=[];$totalBytes=0;$installed=0;
foreach($registry as $id=>$model){$status=miniVrAiModelStatus($model);$root=miniVrAiModelRoot($id);$manifestPath=$root.'/minivr-manifest.json';$manifest=is_file($manifestPath)?json_decode((string)file_get_contents($manifestPath),true):null;$models[]=[$model,$status,$manifest];$totalBytes+=$status['bytes'];if($status['ready'])$installed++;}
function h($v):string{return htmlspecialchars((string)$v,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');}
?><!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/admin.css"><title>Хранилище нейросетей — MiniVR</title><style>
.models{max-width:1100px}.summary{display:flex;gap:12px;flex-wrap:wrap}.summary>div,.model-card{background:#111e2b;border:1px solid #29465a;border-radius:14px;padding:18px}.summary>div{flex:1;min-width:150px}.summary b{font-size:24px;display:block}.summary span,.muted{color:#9bb5c4}.model-card{margin:18px 0}.model-head{display:flex;justify-content:space-between;gap:15px;align-items:center}.model-status{padding:6px 10px;border-radius:20px;background:#4b3420;color:#ffd28b;white-space:nowrap}.model-status.ready{background:#174b38;color:#a7f1c9}.model-meta{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0}.model-meta span{background:#1b3040;border-radius:6px;padding:5px 8px;font-size:12px}.model-files{width:100%;border-collapse:collapse;margin:14px 0}.model-files td{padding:9px;border-bottom:1px solid #294052}.model-actions{display:flex;gap:10px;flex-wrap:wrap}.model-actions button{padding:10px 15px;border:0;border-radius:8px;background:#087f9d;color:white;font-weight:700;cursor:pointer}.model-actions .danger{background:#733c42}.notice{padding:12px;border-radius:8px;margin:14px 0;background:#173e32;color:#a9f1ca}.error{background:#512b30;color:#ffd0d0}.progress{height:7px;background:#233746;border-radius:9px;overflow:hidden}.progress i{display:block;height:100%;background:#27c5dd}.empty{padding:22px;border:1px dashed #3a596c;border-radius:12px;color:#9bb5c4}@media(max-width:700px){.model-head{display:block}.model-status{display:inline-block;margin-top:10px}.model-files{font-size:12px}}
</style></head><body><aside><div class="logo">MINI<span>VR</span></div><a href="/admin/">◉ Панорамы</a><a href="/admin/tours.php">◇ Экскурсии</a><a href="/admin/hotspot-import.php">⌖ Привязка точек JSON</a><a href="/admin/embeds.php">⇧ Встраивание</a><a href="/admin/music.php">♫ Музыка</a><a class="active" href="/admin/models.php">✦ Нейросети</a><a href="/admin/cleanup.php">♻ Очистка файлов</a><a href="/">↗ Открыть сайт</a><a href="/admin/?logout=1">⏻ Выход</a></aside><main class="models"><header><div><small>SHARED AI MODEL REGISTRY</small><h1>Хранилище нейросетей</h1><p class="muted">Единый реестр, установка и хранение моделей для всех AI-инструментов MiniVR</p></div></header>
<?php if($message):?><div class="notice"><?=h($message)?></div><?php endif;?><?php if($error):?><div class="notice error"><?=h($error)?></div><?php endif;?>
<div class="summary"><div><b><?=count($registry)?></b><span>В РЕЕСТРЕ</span></div><div><b><?=$installed?></b><span>УСТАНОВЛЕНО</span></div><div><b><?=number_format($totalBytes/1048576,1,',',' ')?> МБ</b><span>ЗАНЯТО НА ДИСКЕ</span></div></div>
<?php foreach($models as [$model,$status,$manifest]):?><section class="model-card"><div class="model-head"><div><h2><?=h($model['name'])?></h2><p class="muted"><?=h($model['purpose'])?></p></div><span class="model-status <?=$status['ready']?'ready':''?>"><?=$status['ready']?'УСТАНОВЛЕНА':'НЕ УСТАНОВЛЕНА'?></span></div>
<div class="model-meta"><span><?=h($model['provider'])?></span><span><?=h($model['format'])?></span><span><?=h($model['runtime'])?></span><span>Лицензия <?=h($model['license'])?></span><span>ID: <?=h($model['id'])?></span></div>
<p>Занимает <?=number_format($status['bytes']/1048576,2,',',' ')?> МБ · Файлов <?=count(array_filter($status['files'],fn($f)=>$f['ready']))?> / <?=count($status['files'])?></p><div class="progress"><i style="width:<?=count($status['files'])?round(count(array_filter($status['files'],fn($f)=>$f['ready']))/count($status['files'])*100):0?>%;"></i></div>
<table class="model-files"><tbody><?php foreach($status['files'] as $f):?><tr><td><?=h($f['name'])?></td><td><?=number_format($f['size']/1048576,2,',',' ')?> МБ</td><td><?=$f['ready']?'✓ готов':'— отсутствует / повреждён'?></td></tr><?php endforeach;?></tbody></table>
<?php if($manifest):?><p class="muted">Установлена <?=h($manifest['installed_at']??'—')?> · revision <?=h($manifest['revision']??'—')?></p><?php endif;?>
<form method="post" class="model-actions"><input type="hidden" name="csrf" value="<?=h($_SESSION['models_csrf'])?>"><input type="hidden" name="model_id" value="<?=h($model['id'])?>"><button name="action" value="install"><?=$status['ready']?'Проверить / восстановить':'Скачать на сервер'?></button><?php if($status['bytes']>0):?><button class="danger" name="action" value="delete" onclick="return confirm('Удалить файлы этой модели с сервера?')">Удалить</button><?php endif;?></form></section><?php endforeach;?>
<?php if(!$registry):?><div class="empty">Реестр пока пуст. Новые модели добавляются в src/ai-models.php с описанием файлов, версии, лицензии и назначения.</div><?php endif;?>
<p class="muted">Все модели хранятся в /public/models/{model-id}/. Для добавления нового инструмента укажите его модель в общем реестре — отдельный механизм скачивания создавать не нужно.</p></main></body></html>