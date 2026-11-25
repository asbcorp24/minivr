<?php
declare(strict_types=1);
session_start();
require_once __DIR__.'/../../src/db.php';
require_once __DIR__.'/../../src/tiles.php';
require_once __DIR__.'/../../src/panorama-thumbnails.php';
require_once __DIR__.'/../../src/panorama-cleanup.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
function mirrorPngDataUri(mixed $value): mixed {
    if (!is_string($value) || !preg_match('~^data:image/png;base64,([A-Za-z0-9+/=]+)$~D', $value, $m)) return $value;
    $bytes=base64_decode($m[1],true);
    if ($bytes===false || strlen($bytes)>2_000_000 || !extension_loaded('imagick')) return $value;
    $im=new Imagick();
    try {$im->readImageBlob($bytes);$im->flopImage();$im->setImageFormat('png');return 'data:image/png;base64,'.base64_encode($im->getImageBlob());}
    finally {$im->clear();}
}
function mirrorDepthAsset(mixed $url, int $id, array &$created): mixed {
    if(!is_string($url)||!preg_match('~^/uploads/depth/p'.preg_quote((string)$id,'~').'-[a-f0-9]{16}\\.png$~D',$url)) return $url;
    $path=__DIR__.'/..'.$url;if(!is_file($path)||is_link($path)) return $url;
    $dir=dirname($path);$new='p'.$id.'-'.bin2hex(random_bytes(8)).'.png';$im=new Imagick($path);try{$im->flopImage();$im->setImageFormat('png');if(!$im->writeImage($dir.'/'.$new))throw new RuntimeException('Не удалось отразить карту глубины.');}finally{$im->clear();}
    $created[]=$dir.'/'.$new;return '/uploads/depth/'.$new;
}
function mirrorEffectCoordinates(array &$e, int $id, array &$created): void {
    foreach (['sunYaw','moonYaw','waterYaw','riverDirection','waterfallDirection'] as $key) if (isset($e[$key])&&is_numeric($e[$key])) $e[$key]=-(float)$e[$key];
    foreach (['waterPolygon','lamps'] as $key) if (isset($e[$key])&&is_array($e[$key])) foreach($e[$key] as &$p) if(is_array($p)&&isset($p[0])&&is_numeric($p[0])) $p[0]=-(float)$p[0];
    unset($p);
    if(isset($e['masks'])&&is_array($e['masks'])) foreach($e['masks'] as &$points) if(is_array($points)) foreach($points as &$p) if(is_array($p)&&isset($p[0])&&is_numeric($p[0])) $p[0]=-(float)$p[0];
    unset($points,$p);
    if(isset($e['flowArrows'])&&is_array($e['flowArrows'])) foreach($e['flowArrows'] as &$arrows) if(is_array($arrows)) foreach($arrows as &$a) if(is_array($a)&&count($a)>=4){$a[0]=-(float)$a[0];$a[2]=-(float)$a[2];}
    unset($arrows,$a);
    foreach(['parallaxWaterMask','parallaxFoliageMask'] as $key) if(isset($e[$key])) $e[$key]=mirrorPngDataUri($e[$key]);
    foreach(['parallaxDepth','parallaxDepthOriginal'] as $key) if(isset($e[$key])) $e[$key]=mirrorDepthAsset($e[$key],$id,$created);
    $e['mirrorHorizontal']=false;
}
try {
    if(!($_SESSION['admin']??false)) throw new RuntimeException('Требуется вход администратора.');
    if($_SERVER['REQUEST_METHOD']!=='POST') throw new RuntimeException('Метод не поддерживается.');
    if(!hash_equals((string)($_SESSION['panorama_save_csrf']??''),(string)($_POST['csrf_token']??''))) throw new RuntimeException('Сессия устарела. Обновите страницу.');
    $id=(int)($_POST['id']??0);if($id<1)throw new RuntimeException('Не указана панорама.');
    $db=db();$q=$db->prepare('SELECT * FROM panoramas WHERE id=?');$q->execute([$id]);$p=$q->fetch();
    if(!$p)throw new RuntimeException('Панорама не найдена.');
    if(($p['projection']??'360')==='flat')throw new RuntimeException('Физическое отражение доступно для панорам, не для плоских изображений.');
    if(!extension_loaded('imagick'))throw new RuntimeException('Для физического отражения на сервере требуется PHP Imagick. Исходный файл не изменён.');
    $url=(string)$p['image'];$name=basename($url);
    if(!preg_match('~^[a-f0-9]{20}\.(?:jpg|jpeg|png|webp)$~D',$name))throw new RuntimeException('Файл не является управляемой загрузкой MiniVR.');
    $source=UPLOAD_DIR.'/'.$name;if(!is_file($source)||is_link($source))throw new RuntimeException('Исходный файл не найден.');
    $im=new Imagick($source);$im->setIteratorIndex(0);
    if(($p['stereo']??'mono')==='sbs') {
        $w=$im->getImageWidth();$h=$im->getImageHeight();if($w%2!==0)throw new RuntimeException('Ширина SBS-изображения должна делиться на два.');
        $left=clone $im;$right=clone $im;$left->cropImage((int)($w/2),$h,0,0);$right->cropImage((int)($w/2),$h,(int)($w/2),0);$left->flopImage();$right->flopImage();
        $combined=new Imagick();$combined->newImage($w,$h,new ImagickPixel('black'));$combined->setImageFormat('webp');$combined->compositeImage($left,Imagick::COMPOSITE_OVER,0,0);$combined->compositeImage($right,Imagick::COMPOSITE_OVER,(int)($w/2),0);$im->clear();$left->clear();$right->clear();$im=$combined;
    } else { $im->flopImage(); }
    $newName=bin2hex(random_bytes(10)).'.webp';$newPath=UPLOAD_DIR.'/'.$newName;
    $im->setImageFormat('webp');$im->setImageCompressionQuality(92);
    if(!$im->writeImage($newPath)){ $im->clear();throw new RuntimeException('Не удалось сохранить отражённую панораму.');}
    $im->clear();
    $newUrl='/uploads/'.$newName;
    try {
        if(!panoramaCreateThumbnails($newUrl)) throw new RuntimeException('Не удалось создать миниатюры отражённого изображения.');
        $tileDir=__DIR__.'/../tiles/'.pathinfo($newName,PATHINFO_FILENAME);
        if(($p['projection']??'360')==='360'&&($p['stereo']??'mono')==='mono'&&!buildPanoramaTiles($newPath,$tileDir)) {
            // Tiling is optional: the full-resolution image remains usable.
        }
        $effects=json_decode((string)($p['effects']??'{}'),true);if(!is_array($effects))$effects=[];
        mirrorEffectCoordinates($effects,$id,$createdDepth);
        $db->beginTransaction();
        $up=$db->prepare('UPDATE panoramas SET image=?,preview=?,effects=? WHERE id=?');
        $preview=panoramaThumbnailUrl($newUrl,'card');
        $up->execute([$newUrl,$preview,json_encode($effects,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),$id]);
        // Hotspots and guided points are authored in scene-local panorama coordinates.
        $sc=$db->prepare('SELECT id,guided_points FROM tour_scenes WHERE panorama_id=?');$sc->execute([$id]);
        $sceneRows=$sc->fetchAll();
        $hs=$db->prepare('UPDATE hotspots SET yaw=? WHERE scene_id=? AND id=?');
        foreach($sceneRows as $scene){
            $points=json_decode((string)($scene['guided_points']??'[]'),true);
            if(is_array($points)){
                $walk=function(&$v,$key='')use(&$walk){if(is_array($v)){foreach($v as $k=>&$child)$walk($child,(string)$k);unset($child);}elseif(is_numeric($v)&&in_array(strtolower($key),['yaw','longitude','lon'],true))$v=-(float)$v;};
                $walk($points);$st=$db->prepare('UPDATE tour_scenes SET guided_points=? WHERE id=?');$st->execute([json_encode($points,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),(int)$scene['id']]);
            }
            $h=$db->prepare('SELECT id,yaw FROM hotspots WHERE scene_id=?');$h->execute([(int)$scene['id']]);
            foreach($h->fetchAll() as $point)$hs->execute([-(float)$point['yaw'],(int)$scene['id'],(int)$point['id']]);
        }
        $db->commit();
    } catch(Throwable $e) {
        if($db->inTransaction())$db->rollBack();
        @unlink($newPath);foreach($createdDepth as $depthFile)@unlink($depthFile);panoramaRemoveThumbnails($newUrl);
        panoramaRemoveTileTree(__DIR__.'/../tiles/'.pathinfo($newName,PATHINFO_FILENAME));
        throw $e;
    }
    // Retire the old asset only after the database points to the new one.
    panoramaRemoveUnreferenced($db,$url);
    echo json_encode(['ok'=>true,'image'=>$newUrl,'preview'=>$preview,'message'=>'Изображение физически отражено. Миниатюры и тайлы обновлены.'],JSON_UNESCAPED_UNICODE);
} catch(Throwable $e) {
    http_response_code(422);echo json_encode(['ok'=>false,'error'=>$e->getMessage()],JSON_UNESCAPED_UNICODE);
}
