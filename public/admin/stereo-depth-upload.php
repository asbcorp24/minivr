<?php
declare(strict_types=1);
session_start();
require_once __DIR__.'/../../src/db.php';
header('Content-Type: application/json; charset=utf-8');
function replyError(int $status,string $message): never { http_response_code($status);echo json_encode(['ok'=>false,'error'=>$message],JSON_UNESCAPED_UNICODE);exit; }
if(!($_SESSION['admin']??false))replyError(403,'Доступ запрещён');
if($_SERVER['REQUEST_METHOD']!=='POST')replyError(405,'Требуется POST');
if(!hash_equals((string)($_SESSION['stereo_depth_csrf']??''),(string)($_POST['csrf']??'')))replyError(403,'Недействительный токен формы');
$id=(int)($_POST['hotspot']??0);
$scene=(int)($_POST['scene']??0);
$q=db()->prepare("SELECT id,content,image_stereo,depth_map FROM hotspots WHERE id=? AND scene_id=? AND type='image' AND image_stereo IN ('sbs','tb')");
$q->execute([$id,$scene]);$h=$q->fetch();
if(!$h)replyError(404,'Стереофото не найдено');
$url=(string)$h['content'];
$root=realpath(UPLOAD_DIR);
$path=realpath(UPLOAD_DIR.'/'.basename($url));
if(!$root||!$path||dirname($path)!==$root||!preg_match('~^/uploads/[^/]+$~D',$url))replyError(400,'Поддерживаются только загруженные файлы');
if(!isset($_FILES['depth'])||($_FILES['depth']['error']??UPLOAD_ERR_NO_FILE)!==UPLOAD_ERR_OK)replyError(400,'Нет PNG карты глубины');
$f=$_FILES['depth'];
if($f['size']>4*1024*1024)replyError(400,'Карта глубины больше 4 МБ');
$info=@getimagesize($f['tmp_name']);
if(!$info||$info[2]!==IMAGETYPE_PNG||$info[0]<128||$info[1]<64||$info[0]>2048||$info[1]>2048)replyError(400,'Ожидается PNG глубины от 128×64 до 2048×2048');
$original=@getimagesize($path);
if(!$original)replyError(400,'Исходное фото повреждено');
$eyeW=$h['image_stereo']==='sbs'?$original[0]/2:$original[0];
$eyeH=$h['image_stereo']==='tb'?$original[1]/2:$original[1];
if(abs($info[0]/$info[1]-$eyeW/$eyeH)>.04)replyError(400,'Пропорции карты глубины не совпадают с одним ракурсом');
$dir=UPLOAD_DIR.'/depth';
if(!is_dir($dir)&&!mkdir($dir,0755,true)&&!is_dir($dir))replyError(500,'Не удалось создать каталог');
$name='h'.$id.'-'.bin2hex(random_bytes(8)).'.png';
if(!move_uploaded_file($f['tmp_name'],$dir.'/'.$name))replyError(500,'Не удалось сохранить PNG');
$new='/uploads/depth/'.$name;
try{$q=db()->prepare('UPDATE hotspots SET depth_map=? WHERE id=? AND scene_id=?');$q->execute([$new,$id,$scene]);}
catch(Throwable $e){@unlink($dir.'/'.$name);replyError(500,'Ошибка базы данных');}
$old=(string)($h['depth_map']??'');
if(preg_match('~^/uploads/depth/h'. $id .'-[a-f0-9]{16}\\.png$~D',$old))@unlink(__DIR__.'/..'.$old);
echo json_encode(['ok'=>true,'url'=>$new],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
