<?php
declare(strict_types=1);
session_start();
require_once __DIR__.'/../../src/db.php';
if (empty($_SESSION['admin'])) { header('Location: /admin/'); exit; }
$db=db();
$db->exec("CREATE TABLE IF NOT EXISTS music_tracks (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,artist TEXT NOT NULL DEFAULT '',file_path TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
$token=$_SESSION['music_csrf']??=bin2hex(random_bytes(24));
$error='';
if ($_SERVER['REQUEST_METHOD']==='POST') {
 if (!hash_equals($token,(string)($_POST['csrf']??''))) {http_response_code(403);exit('CSRF');}
 $action=$_POST['action']??'save';$id=(int)($_POST['id']??0);
 if ($action==='delete' && $id) {
  $q=$db->prepare('SELECT file_path FROM music_tracks WHERE id=?');$q->execute([$id]);$old=$q->fetch();
  if ($old) {$db->prepare('DELETE FROM music_tracks WHERE id=?')->execute([$id]);$path=realpath(__DIR__.'/../'.ltrim($old['file_path'],'/'));$base=realpath(__DIR__.'/../uploads/music');if($path&&$base&&str_starts_with($path,$base.DIRECTORY_SEPARATOR))@unlink($path);}
  header('Location: /admin/music.php');exit;
 }
 if ($action==='save') {
  $title=trim((string)($_POST['title']??''));$artist=trim((string)($_POST['artist']??''));$order=max(0,(int)($_POST['sort_order']??0));$active=isset($_POST['is_active'])?1:0;
  $old=null;if($id){$q=$db->prepare('SELECT * FROM music_tracks WHERE id=?');$q->execute([$id]);$old=$q->fetch();}
  $path=$old['file_path']??'';
  if(isset($_FILES['audio_file'])&&$_FILES['audio_file']['error']===UPLOAD_ERR_OK){
   $file=$_FILES['audio_file'];$ext=strtolower(pathinfo($file['name'],PATHINFO_EXTENSION));
   $allowed=['mp3'=>['audio/mpeg','audio/mp3'],'wav'=>['audio/wav','audio/x-wav','audio/wave'],'ogg'=>['audio/ogg','application/ogg'],'m4a'=>['audio/mp4','audio/x-m4a'],'aac'=>['audio/aac','audio/x-aac']];
   $mime=(new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
   if($file['size']>50*1024*1024||!isset($allowed[$ext])||!in_array($mime,$allowed[$ext],true))$error='Недопустимый формат или размер файла (максимум 50 МБ).';
   else {$dir=__DIR__.'/../uploads/music';if(!is_dir($dir))mkdir($dir,0775,true);$name=bin2hex(random_bytes(16)).'.'.$ext;if(!move_uploaded_file($file['tmp_name'],$dir.'/'.$name))$error='Не удалось сохранить файл.';else $path='/uploads/music/'.$name;}
  } elseif(!$old) $error='Выберите аудиофайл.';
  if(!$title)$error='Введите название.';
  if(!$error){
   if($old){$db->prepare('UPDATE music_tracks SET title=?,artist=?,file_path=?,sort_order=?,is_active=? WHERE id=?')->execute([$title,$artist,$path,$order,$active,$id]);if($path!==$old['file_path'])@unlink(__DIR__.'/../'.ltrim($old['file_path'],'/'));}
   else $db->prepare('INSERT INTO music_tracks(title,artist,file_path,sort_order,is_active) VALUES(?,?,?,?,?)')->execute([$title,$artist,$path,$order,$active]);
   header('Location: /admin/music.php');exit;
  }
 }
}
$edit=null;if(isset($_GET['edit'])){$q=$db->prepare('SELECT * FROM music_tracks WHERE id=?');$q->execute([(int)$_GET['edit']]);$edit=$q->fetch();}
$tracks=$db->query('SELECT * FROM music_tracks ORDER BY sort_order,id')->fetchAll();
?><!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Музыка — MiniVR</title><link rel="stylesheet" href="/assets/admin.css"></head><body><aside><div class="logo">MINI<span>VR</span></div><a href="/admin/">◉ Панорамы</a><a href="/admin/tours.php">◇ Экскурсии</a><a class="active" href="/admin/music.php">♫ Музыка</a><a href="/">↗ Открыть сайт</a><a href="/admin/?logout=1">⏻ Выход</a></aside><main><header><div><small>CONTENT SYSTEM</small><h1>Музыка сайта</h1></div></header><?php if($error):?><p style="color:#ff7188"><?=htmlspecialchars($error)?></p><?php endif;?><section style="max-width:650px;margin-bottom:35px"><h2><?=$edit?'Редактировать трек':'Загрузить трек'?></h2><form method="post" enctype="multipart/form-data" style="display:grid;gap:14px"><input type="hidden" name="csrf" value="<?=htmlspecialchars($token)?>"><input type="hidden" name="action" value="save"><input type="hidden" name="id" value="<?=(int)($edit['id']??0)?>"><label>Название<input name="title" required maxlength="255" value="<?=htmlspecialchars($edit['title']??'')?>"></label><label>Исполнитель<input name="artist" maxlength="255" value="<?=htmlspecialchars($edit['artist']??'')?>"></label><label>Аудиофайл (MP3, WAV, OGG, M4A, AAC; до 50 МБ)<input type="file" name="audio_file" accept=".mp3,.wav,.ogg,.m4a,.aac,audio/*" <?=$edit?'':'required'?>></label><label>Порядок<input type="number" name="sort_order" min="0" value="<?=(int)($edit['sort_order']??0)?>"></label><label><input type="checkbox" name="is_active" value="1" <?=($edit['is_active']??1)?'checked':''?>> Опубликован</label><button class="btn" type="submit">СОХРАНИТЬ</button></form></section><h2>Плейлист</h2><div class="table"><?php foreach($tracks as $t):?><div class="row"><div class="grow"><b><?=htmlspecialchars($t['title'])?></b><small><?=htmlspecialchars($t['artist'])?></small></div><span class="status"><?=$t['is_active']?'ONLINE':'DRAFT'?></span><audio controls preload="none" src="<?=htmlspecialchars($t['file_path'])?>"></audio><a href="?edit=<?=$t['id']?>">ИЗМЕНИТЬ</a><form method="post" onsubmit="return confirm('Удалить трек?')"><input type="hidden" name="csrf" value="<?=htmlspecialchars($token)?>"><input type="hidden" name="action" value="delete"><input type="hidden" name="id" value="<?=$t['id']?>"><button class="danger">УДАЛИТЬ</button></form></div><?php endforeach;?></div></main></body></html>