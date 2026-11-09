<?php
session_start();
require_once __DIR__.'/../../src/db.php';
require_once __DIR__.'/../../src/panorama-cleanup.php';
if (!($_SESSION['admin']??false)) { header('Location:/admin/'); exit; }
if (empty($_SESSION['cleanup_csrf'])) $_SESSION['cleanup_csrf']=bin2hex(random_bytes(24));
$message='';
if ($_SERVER['REQUEST_METHOD']==='POST') {
 if (!hash_equals($_SESSION['cleanup_csrf'],(string)($_POST['csrf']??''))) {
  http_response_code(403); exit('Неверный токен запроса');
 }
 $removed=0;
 // Recompute the list on submission. Never trust submitted file paths.
 foreach (panoramaOrphanImages(db()) as $item) {
  if (panoramaRemoveUnreferenced(db(),$item['url'])) $removed++;
 }
 $message='Удалено неиспользуемых изображений: '.$removed;
}
$orphans=panoramaOrphanImages(db());
$total=array_sum(array_column($orphans,'size'));
?>
<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Очистка файлов — MiniVR</title><link rel="stylesheet" href="/assets/admin.css"></head>
<body><main style="max-width:1000px;margin:auto;padding:32px"><a href="/admin/">← Панорамы</a><h1>Очистка неиспользуемых изображений</h1>
<p>Предварительный просмотр. Удаляются только файлы MiniVR со случайными именами, на которые больше нет ссылок в панорамах, превью и обложках экскурсий. Вместе с ними удаляются связанные тайлы.</p>
<?php if($message):?><p role="status"><?=htmlspecialchars($message,ENT_QUOTES)?></p><?php endif;?>
<p><strong>Файлов: <?=count($orphans)?></strong> · Объём: <?=htmlspecialchars(number_format($total/1048576,2,',',' '))?> МБ</p>
<?php if($orphans):?>
<div style="max-height:400px;overflow:auto"><table style="width:100%;text-align:left"><thead><tr><th>Файл</th><th>Размер</th></tr></thead><tbody>
<?php foreach($orphans as $item):?><tr><td><?=htmlspecialchars($item['url'],ENT_QUOTES)?></td><td><?=htmlspecialchars(number_format($item['size']/1048576,2,',',' '))?> МБ</td></tr><?php endforeach;?></tbody></table></div>
<form method="post" onsubmit="return confirm('Удалить перечисленные неиспользуемые файлы и их тайлы?')"><input type="hidden" name="csrf" value="<?=htmlspecialchars($_SESSION['cleanup_csrf'],ENT_QUOTES)?>"><button class="btn" type="submit">Удалить неиспользуемые файлы</button></form>
<?php else:?><p>Неиспользуемых файлов не найдено.</p><?php endif;?>
</main></body></html>
