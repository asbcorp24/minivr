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
 $effects=json_decode($p['effects']??'{}',true)?:[];
 $isManual=($_POST['manual']??'')==='1';
 $action=(string)($_POST['action']??'');
 $ownedPath=static fn($path): bool => is_string($path)&&preg_match('~^/uploads/depth/p'.$id.'-[a-f0-9]{16}\\.png$~D',$path)===1;
 if($action==='restore'){
  $original=$effects['parallaxDepthOriginal']??null;
  if(!$ownedPath($original)||!is_file(__DIR__.'/..'.$original))throw new RuntimeException('Исходная карта глубины не найдена');
  $current=$effects['parallaxDepth']??null;
  $effects['parallaxDepth']=$original;unset($effects['parallaxDepthOriginal']);
  $q=db()->prepare('UPDATE panoramas SET effects=? WHERE id=?');$q->execute([json_encode($effects,JSON_UNESCAPED_UNICODE),$id]);
  if($ownedPath($current)&&$current!==$original)@unlink(__DIR__.'/..'.$current);
  echo json_encode(['ok'=>true,'url'=>$original]);exit;
 }
 if(!isset($_FILES['depth'])||$_FILES['depth']['error']!==UPLOAD_ERR_OK)throw new RuntimeException('Карта глубины не загружена');
 $f=$_FILES['depth'];
 if($f['size']>4*1024*1024)throw new RuntimeException('Карта глубины превышает 4 МБ');
 $info=@getimagesize($f['tmp_name']);
 if(!$info||$info[2]!==IMAGETYPE_PNG||$info[0]<128||$info[1]<64||$info[0]!==$info[1]*2||$info[0]>2048)throw new RuntimeException('Ожидается PNG карта глубины 2:1, не более 2048 пикселей');
 $dir=__DIR__.'/../uploads/depth';if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Невозможно создать каталог');
 $name='p'.$id.'-'.bin2hex(random_bytes(8)).'.png';
 if(!move_uploaded_file($f['tmp_name'],$dir.'/'.$name))throw new RuntimeException('Ошибка сохранения');
 $old=$effects['parallaxDepth']??null;
 $original=$effects['parallaxDepthOriginal']??null;
 if($isManual){
  if(!$ownedPath($original)&&$ownedPath($old))$effects['parallaxDepthOriginal']=$old;
  // The editor's masks are based on these settings. Persist them together
  // with the corrected PNG so the next panorama view uses the same layers.
  if(isset($_POST['groups']))$effects['parallaxGroups']=max(2,min(10,(int)$_POST['groups']));
  if(isset($_POST['nonlinear']))$effects['parallaxNonlinear']=$_POST['nonlinear']==='1';
  if(isset($_POST['nonlinearStrength']))$effects['parallaxNonlinearStrength']=max(0,min(100,(int)$_POST['nonlinearStrength']));
 }else{
  unset($effects['parallaxDepthOriginal']);
 }
 $effects['parallaxDepth']='/uploads/depth/'.$name;
 $effects['parallaxEnabled']=true;
 $effects['parallaxStrength']=max(0,min(100,(int)($_POST['strength']??25)));
 $q=db()->prepare('UPDATE panoramas SET effects=? WHERE id=?');$q->execute([json_encode($effects,JSON_UNESCAPED_UNICODE),$id]);
 if($ownedPath($old)&&$old!==($effects['parallaxDepthOriginal']??null))@unlink(__DIR__.'/..'.$old);
 if(!$isManual&&$ownedPath($original)&&$original!==$old)@unlink(__DIR__.'/..'.$original);
 echo json_encode(['ok'=>true,'url'=>$effects['parallaxDepth']]);
}catch(Throwable $e){http_response_code(400);echo json_encode(['error'=>$e->getMessage()],JSON_UNESCAPED_UNICODE);}
