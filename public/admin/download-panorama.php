<?php
session_start();
require_once __DIR__.'/../../src/db.php';
if(!($_SESSION['admin']??false)){http_response_code(403);exit('Доступ запрещён');}
$id=filter_input(INPUT_GET,'id',FILTER_VALIDATE_INT);
if(!$id||$id<1){http_response_code(400);exit('Некорректный ID');}
$stmt=db()->prepare('SELECT image FROM panoramas WHERE id=?');
$stmt->execute([$id]);
$image=$stmt->fetchColumn();
if(!is_string($image)||!preg_match('~^/uploads/([a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp))$~iD',$image,$m)){http_response_code(404);exit('Панорама не найдена');}
$file=UPLOAD_DIR.'/'.$m[1];
if(!is_file($file)||is_link($file)||!is_readable($file)){http_response_code(404);exit('Файл не найден');}
$mime=['jpg'=>'image/jpeg','jpeg'=>'image/jpeg','png'=>'image/png','webp'=>'image/webp'][strtolower(pathinfo($m[1],PATHINFO_EXTENSION))];
header('Content-Type: '.$mime);
header('Content-Disposition: attachment; filename="'.$m[1].'"');
header('Content-Length: '.filesize($file));
header('X-Content-Type-Options: nosniff');
header('Cache-Control: private, no-store');
readfile($file);
