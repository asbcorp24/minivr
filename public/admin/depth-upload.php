<?php
session_start();
require_once __DIR__.'/../../src/db.php';
header('Content-Type: application/json; charset=utf-8');
if(!($_SESSION['admin']??false)){http_response_code(403);echo json_encode(['error'=>'Доступ запрещён']);exit;}
if($_SERVER['REQUEST_METHOD']!=='POST'){http_response_code(405);exit;}
try{
 $id=(int)($_POST['id']??0);
 $q=db()->prepare('SELECT id,image,projection,stereo,effects FROM panoramas WHERE id=?');$q->execute([$id]);$p=$q->fetch();
 if(!$p||$p['projection']!=='360'||$p['stereo']!=='mono')throw new RuntimeException('Требуется сохранённая моно-панорама 360°');
 if(!isset($_FILES['depth'])||$_FILES['depth']['error']!==UPLOAD_ERR_OK)throw new RuntimeException('Карта глубины не загружена');
 $f=$_FILES['depth'];
 if($f['size']>4*1024*1024)throw new RuntimeException('Карта глубины превышает 4 МБ');
 $info=@getimagesize($f['tmp_name']);
 if(!$info||$info[2]!==IMAGETYPE_PNG||$info[0]<128||$info[1]<64||$info[0]!==$info[1]*2||$info[0]>2048)throw new RuntimeException('Ожидается PNG карта глубины 2:1, не более 2048 пикселей');
 $dir=__DIR__.'/../uploads/depth';if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Невозможно создать каталог');
 $name='p'.$id.'-'.bin2hex(random_bytes(8)).'.png';
 if(!move_uploaded_file($f['tmp_name'],$dir.'/'.$name))throw new RuntimeException('Ошибка сохранения');
 $effects=json_decode($p['effects']??'{}',true)?:[];
 $old=$effects['parallaxDepth']??null;
 $effects['parallaxDepth']='/uploads/depth/'.$name;
 $effects['parallaxEnabled']=true;
 $effects['parallaxStrength']=max(0,min(100,(int)($_POST['strength']??25)));
 $q=db()->prepare('UPDATE panoramas SET effects=? WHERE id=?');$q->execute([json_encode($effects,JSON_UNESCAPED_UNICODE),$id]);
 if(is_string($old)&&preg_match('~^/uploads/depth/p'. $id .'-[a-f0-9]{16}\\.png$~',$old))@unlink(__DIR__.'/..'.$old);
 echo json_encode(['ok'=>true,'url'=>$effects['parallaxDepth']]);
}catch(Throwable $e){http_response_code(400);echo json_encode(['error'=>$e->getMessage()],JSON_UNESCAPED_UNICODE);}
