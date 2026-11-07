<?php
session_start();
require_once __DIR__.'/../../src/db.php';
header('Content-Type: application/json; charset=utf-8');
if(!($_SESSION['admin']??false)){http_response_code(403);echo json_encode(['error'=>'Доступ запрещён']);exit;}
if($_SERVER['REQUEST_METHOD']!=='POST'){http_response_code(405);exit;}
try{
 $id=(int)($_POST['id']??0);
 $q=db()->prepare('SELECT id,projection,stereo,effects FROM panoramas WHERE id=?');$q->execute([$id]);$p=$q->fetch();
 if(!$p||$p['projection']!=='360'||$p['stereo']!=='mono')throw new RuntimeException('Нужна сохранённая моно-панорама 360°');
 $effects=json_decode($p['effects']??'{}',true)?:[];
 if(empty($effects['parallaxDepth']))throw new RuntimeException('Сначала сохраните карту глубины');
 $f=$_FILES['background']??null;
 if(!$f||$f['error']!==UPLOAD_ERR_OK||$f['size']>8*1024*1024)throw new RuntimeException('Ошибка загрузки PNG (максимум 8 МБ)');
 $info=@getimagesize($f['tmp_name']);
 if(!$info||$info[2]!==IMAGETYPE_PNG||$info[0]!==1024||$info[1]!==512)throw new RuntimeException('Требуется PNG 1024×512');
 $dir=__DIR__.'/../uploads/depth';if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Невозможно создать каталог');
 $name='bg'.$id.'-'.bin2hex(random_bytes(8)).'.png';
 if(!move_uploaded_file($f['tmp_name'],$dir.'/'.$name))throw new RuntimeException('Ошибка сохранения PNG');
 $old=$effects['parallaxBackground']??null;
 $effects['parallaxBackground']='/uploads/depth/'.$name;
 try{$q=db()->prepare('UPDATE panoramas SET effects=? WHERE id=?');$q->execute([json_encode($effects,JSON_UNESCAPED_UNICODE),$id]);}
 catch(Throwable $e){@unlink($dir.'/'.$name);throw $e;}
 if(is_string($old)&&preg_match('~^/uploads/depth/bg'.$id.'-[a-f0-9]{16}\\.png$~',$old))@unlink(__DIR__.'/..'.$old);
 echo json_encode(['ok'=>true,'url'=>$effects['parallaxBackground']]);
}catch(Throwable $e){http_response_code(400);echo json_encode(['error'=>$e->getMessage()],JSON_UNESCAPED_UNICODE);}
