<?php
session_start();
header('Content-Type: application/json; charset=utf-8');
if(!($_SESSION['admin']??false)){http_response_code(403);echo json_encode(['error'=>'Доступ запрещён']);exit;}
try{
 if($_SERVER['REQUEST_METHOD']!=='POST')throw new RuntimeException('Требуется POST');
 $f=$_FILES['audio']??null;
 if(!$f||$f['error']!==UPLOAD_ERR_OK||$f['size']<1||$f['size']>20*1024*1024)throw new RuntimeException('Аудио должно быть до 20 МБ');
 $ext=strtolower(pathinfo($f['name'],PATHINFO_EXTENSION));
 if(!in_array($ext,['mp3','ogg','wav'],true))throw new RuntimeException('Допустимы MP3, OGG и WAV');
 $mime=(new finfo(FILEINFO_MIME_TYPE))->file($f['tmp_name']);
 $allowed=['mp3'=>['audio/mpeg','audio/mp3','application/octet-stream'],'ogg'=>['audio/ogg','application/ogg'],'wav'=>['audio/wav','audio/x-wav','audio/wave','audio/vnd.wave']];
 if(!in_array($mime,$allowed[$ext],true))throw new RuntimeException('Неверный формат аудио');
 $dir=__DIR__.'/../uploads/guided-audio';
 if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Не удалось создать каталог');
 $name=bin2hex(random_bytes(16)).'.'.$ext;
 if(!move_uploaded_file($f['tmp_name'],$dir.'/'.$name))throw new RuntimeException('Не удалось сохранить аудио');
 echo json_encode(['ok'=>true,'url'=>'/uploads/guided-audio/'.$name]);
}catch(Throwable $e){http_response_code(400);echo json_encode(['error'=>$e->getMessage()],JSON_UNESCAPED_UNICODE);}
