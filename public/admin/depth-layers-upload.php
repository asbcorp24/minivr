<?php
session_start();require_once __DIR__.'/../../src/db.php';
header('Content-Type: application/json; charset=utf-8');
if(!($_SESSION['admin']??false)){http_response_code(403);echo json_encode(['error'=>'Доступ запрещён']);exit;}
if($_SERVER['REQUEST_METHOD']!=='POST'){http_response_code(405);exit;}
$written=[];
try{
$id=(int)($_POST['id']??0);$q=db()->prepare('SELECT projection,stereo,effects FROM panoramas WHERE id=?');$q->execute([$id]);$p=$q->fetch();
if(!$p||$p['projection']!=='360'||$p['stereo']!=='mono')throw new RuntimeException('Нужна моно-панорама 360°');
$effects=json_decode($p['effects']??'{}',true)?:[];if(empty($effects['parallaxDepth']))throw new RuntimeException('Сначала сохраните карту глубины');
$count=max(2,min(10,(int)($effects['parallaxGroups']??5)));$files=$_FILES['layers']??null;
if(!$files||!is_array($files['name']??null)||count($files['name'])!==$count)throw new RuntimeException('Нужно '.$count.' изображений');
$dir=__DIR__.'/../uploads/depth';if(!is_dir($dir)&&!mkdir($dir,0755,true))throw new RuntimeException('Ошибка каталога');
$urls=[];
for($i=0;$i<$count;$i++){
if(($files['error'][$i]??1)!==UPLOAD_ERR_OK||($files['size'][$i]??0)>8*1024*1024)throw new RuntimeException('Ошибка загрузки слоя');
$tmp=$files['tmp_name'][$i];$info=@getimagesize($tmp);
if(!$info||$info[2]!==IMAGETYPE_PNG||$info[0]!==1024||$info[1]!==512)throw new RuntimeException('Нужен PNG 1024×512');
$name='layer'.$id.'-'.bin2hex(random_bytes(8)).'.png';
if(!move_uploaded_file($tmp,$dir.'/'.$name))throw new RuntimeException('Ошибка сохранения');
$written[]=$dir.'/'.$name;$urls[]='/uploads/depth/'.$name;
}
$old=$effects['parallaxLayers']??[];$effects['parallaxLayers']=$urls;
$q=db()->prepare('UPDATE panoramas SET effects=? WHERE id=?');$q->execute([json_encode($effects,JSON_UNESCAPED_UNICODE),$id]);
foreach((array)$old as $url)if(is_string($url)&&preg_match('~^/uploads/depth/layer'.$id.'-[a-f0-9]{16}\\.png$~',$url))@unlink(__DIR__.'/..'.$url);
echo json_encode(['ok'=>true,'layers'=>$urls],JSON_UNESCAPED_UNICODE);
}catch(Throwable $e){foreach($written as $file)@unlink($file);http_response_code(400);echo json_encode(['error'=>$e->getMessage()],JSON_UNESCAPED_UNICODE);}
