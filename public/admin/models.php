<?php
declare(strict_types=1);
session_start();
require_once __DIR__.'/../../src/db.php';
if(!($_SESSION['admin']??false)){http_response_code(403);exit('Доступ запрещён');}
if(empty($_SESSION['models_csrf']))$_SESSION['models_csrf']=bin2hex(random_bytes(32));
$root=__DIR__.'/../models/slimsam-77-uniform';
$public='/models/slimsam-77-uniform';
$revision='5850ab45f587c112167512ffef949107115e26a0';
$files=[
 'config.json'=>['url'=>"https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$revision/config.json",'min'=>100,'max'=>100000],
 'preprocessor_config.json'=>['url'=>"https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$revision/preprocessor_config.json",'min'=>100,'max'=>100000],
 'quantize_config.json'=>['url'=>"https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$revision/quantize_config.json",'min'=>100,'max'=>100000],
 'onnx/vision_encoder_quantized.onnx'=>['url'=>"https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$revision/onnx/vision_encoder_quantized.onnx",'min'=>1000000,'max'=>30000000],
 'onnx/prompt_encoder_mask_decoder_quantized.onnx'=>['url'=>"https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$revision/onnx/prompt_encoder_mask_decoder_quantized.onnx",'min'=>1000000,'max'=>20000000],
 // Transformers.js 3.7.6 resolves the q8 ONNX variant using the canonical
 // component filenames. Store the quantized payloads under those exact names.
 'onnx/vision_encoder.onnx'=>['url'=>"https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$revision/onnx/vision_encoder_quantized.onnx",'min'=>1000000,'max'=>30000000],
 'onnx/prompt_encoder_mask_decoder.onnx'=>['url'=>"https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$revision/onnx/prompt_encoder_mask_decoder_quantized.onnx",'min'=>1000000,'max'=>20000000],
];
function modelDownload(string $url,string $target,int $min,int $max):void {
 $dir=dirname($target);if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Не удалось создать каталог модели');
 $tmp=$target.'.part';$out=fopen($tmp,'wb');if(!$out)throw new RuntimeException('Не удалось создать временный файл');
 try {
  if(function_exists('curl_init')){
   $ch=curl_init($url);curl_setopt_array($ch,[CURLOPT_FILE=>$out,CURLOPT_FOLLOWLOCATION=>true,CURLOPT_CONNECTTIMEOUT=>20,CURLOPT_TIMEOUT=>600,CURLOPT_USERAGENT=>'MiniVR Model Manager/1.0',CURLOPT_FAILONERROR=>true]);
   $ok=curl_exec($ch);$code=(int)curl_getinfo($ch,CURLINFO_HTTP_CODE);$err=curl_error($ch);curl_close($ch);
   if(!$ok||$code!==200)throw new RuntimeException('Ошибка загрузки модели: HTTP '.$code.' '.$err);
  }else{
   $ctx=stream_context_create(['http'=>['timeout'=>600,'follow_location'=>1,'user_agent'=>'MiniVR Model Manager/1.0']]);
   $in=@fopen($url,'rb',false,$ctx);if(!$in)throw new RuntimeException('Не удалось скачать файл модели (нужен cURL или allow_url_fopen)');
   stream_copy_to_stream($in,$out);fclose($in);
  }
 }finally{fclose($out);}
 $size=@filesize($tmp);if($size===false||$size<$min||$size>$max){@unlink($tmp);throw new RuntimeException('Некорректный размер загруженного файла: '.(int)$size);}
 if(!rename($tmp,$target)){@unlink($tmp);throw new RuntimeException('Не удалось сохранить файл модели');}
}
function modelStatus(string $root,array $files):array{
 $items=[];$total=0;$ready=true;
 foreach($files as $name=>$meta){$path=$root.'/'.$name;$size=is_file($path)&&!is_link($path)?(int)filesize($path):0;$ok=$size>=$meta['min']&&$size<=$meta['max'];$items[]=['name'=>$name,'size'=>$size,'ready'=>$ok];$total+=$size;$ready=$ready&&$ok;}
 return ['ready'=>$ready,'bytes'=>$total,'files'=>$items];
}
$message='';$error='';
if($_SERVER['REQUEST_METHOD']==='POST'){
 if(!hash_equals($_SESSION['models_csrf'],(string)($_POST['csrf']??''))){http_response_code(403);exit('Неверный защитный токен');}
 try{
  $action=(string)($_POST['action']??'');
  if($action==='install'){
   foreach($files as $name=>$meta){$target=$root.'/'.$name;$size=is_file($target)?(int)filesize($target):0;if($size<$meta['min']||$size>$meta['max'])modelDownload($meta['url'],$target,$meta['min'],$meta['max']);}
   $manifest=['id'=>'slimsam-77-uniform','revision'=>$revision,'license'=>'Apache-2.0','installed_at'=>gmdate('c'),'status'=>modelStatus($root,$files)];
   if(!is_dir($root)&&!mkdir($root,0755,true))throw new RuntimeException('Не удалось создать папку модели');
   file_put_contents($root.'/minivr-manifest.json',json_encode($manifest,JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
   $message='Модель успешно установлена на сервер.';
  }elseif($action==='delete'){
   $it=new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root,FilesystemIterator::SKIP_DOTS),RecursiveIteratorIterator::CHILD_FIRST);
   foreach($it as $f){if($f->isDir()&&!$f->isLink())rmdir($f->getPathname());else unlink($f->getPathname());}
   if(is_dir($root))rmdir($root);$message='Файлы модели удалены с сервера.';
  }else throw new RuntimeException('Неизвестная команда');
 }catch(Throwable $e){$error=$e->getMessage();}
}
$status=modelStatus($root,$files);$manifestPath=$root.'/minivr-manifest.json';$manifest=is_file($manifestPath)?json_decode((string)file_get_contents($manifestPath),true):null;
function h($v):string{return htmlspecialchars((string)$v,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8');}
?><!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/assets/admin.css"><title>Нейросети — MiniVR</title><style>
.models{max-width:1000px}.model-card{background:#111e2b;border:1px solid #29465a;border-radius:14px;padding:22px;margin:20px 0}.model-head{display:flex;justify-content:space-between;gap:15px;align-items:center}.model-status{padding:6px 10px;border-radius:20px;background:#4b3420;color:#ffd28b}.model-status.ready{background:#174b38;color:#a7f1c9}.model-files{width:100%;border-collapse:collapse;margin:16px 0}.model-files td{padding:10px;border-bottom:1px solid #294052}.model-actions{display:flex;gap:10px;flex-wrap:wrap}.model-actions button{padding:11px 16px;border:0;border-radius:8px;background:#087f9d;color:white;font-weight:700;cursor:pointer}.model-actions .danger{background:#733c42}.notice{padding:12px;border-radius:8px;margin:14px 0;background:#173e32;color:#a9f1ca}.error{background:#512b30;color:#ffd0d0}.muted{color:#9bb5c4}.progress{height:7px;background:#233746;border-radius:9px;overflow:hidden}.progress i{display:block;height:100%;width:0;background:#27c5dd;transition:width .2s}@media(max-width:700px){.model-head{display:block}.model-status{display:inline-block;margin-top:10px}}
</style></head><body><aside><div class="logo">MINI<span>VR</span></div><a href="/admin/">◉ Панорамы</a><a href="/admin/tours.php">◇ Экскурсии</a><a href="/admin/hotspot-import.php">⌖ Привязка точек JSON</a><a href="/admin/embeds.php">⇧ Встраивание</a><a href="/admin/music.php">♫ Музыка</a><a class="active" href="/admin/models.php">✦ Нейросети</a><a href="/admin/cleanup.php">♻ Очистка файлов</a><a href="/">↗ Открыть сайт</a><a href="/admin/?logout=1">⏻ Выход</a></aside><main class="models"><header><div><small>AI MODEL STORAGE</small><h1>Нейросети</h1><p class="muted">Единое серверное хранилище моделей MiniVR</p></div></header>
<?php if($message):?><div class="notice"><?=h($message)?></div><?php endif;?><?php if($error):?><div class="notice error"><?=h($error)?></div><?php endif;?>
<section class="model-card"><div class="model-head"><div><h2>SlimSAM 77 — выделение объектов</h2><p class="muted">Сегментация по щелчку мыши в ручном редакторе слоёв параллакса</p></div><span class="model-status <?=$status['ready']?'ready':''?>"><?=$status['ready']?'УСТАНОВЛЕНА':'НЕ УСТАНОВЛЕНА'?></span></div>
<p>Размер: <?=number_format($status['bytes']/1048576,1,',',' ')?> МБ · Формат ONNX · Лицензия Apache-2.0 · Ревизия <?=h(substr($revision,0,12))?></p>
<div class="progress"><i style="width:<?=$status['ready']?100:0?>%"></i></div>
<table class="model-files"><tbody><?php foreach($status['files'] as $f):?><tr><td><?=h($f['name'])?></td><td><?=number_format($f['size']/1048576,2,',',' ')?> МБ</td><td><?=$f['ready']?'✓ готов':'— отсутствует'?></td></tr><?php endforeach;?></tbody></table>
<?php if($manifest):?><p class="muted">Установлена: <?=h($manifest['installed_at']??'неизвестно')?> · Модель хранится на сервере и доступна всем администраторам.</p><?php endif;?>
<form method="post" class="model-actions"><input type="hidden" name="csrf" value="<?=h($_SESSION['models_csrf'])?>"><button name="action" value="install"><?=$status['ready']?'Проверить / восстановить файлы':'Скачать модель на сервер'?></button><?php if(array_sum(array_column($status['files'],'size'))>0):?><button class="danger" name="action" value="delete" onclick="return confirm('Удалить файлы модели с сервера?')">Удалить модель</button><?php endif;?></form>
<p class="muted">Загрузка выполняется сервером напрямую с Hugging Face. При повторном нажатии уже корректные файлы не скачиваются повторно.</p></section>
</main></body></html>