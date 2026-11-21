<?php
require_once __DIR__.'/../src/db.php';
$id=(int)($_GET['id']??0);
$tour=(int)($_GET['tour']??0);
$sceneId=(int)($_GET['scene']??0);
$embedToken=(string)($_GET['embed']??'');
$embedded=$embedToken!=='';
if($embedded){
    require_once __DIR__.'/../src/embed-links.php';
    $embedLink=resolveEmbedToken(db(),$embedToken);
    if(!$embedLink||!embedAllowsScene(db(),$embedLink,$id,$tour,$sceneId)){
        http_response_code(403);header('Cache-Control: private, no-store');exit('Недействительная ссылка встраивания.');
    }
    // Framing is enabled only for a valid, scoped embed capability. The
    // ordinary viewer and administrator pages retain their existing policy.
    header_remove('X-Frame-Options');
    header('Content-Security-Policy: frame-ancestors *');
    header('Cache-Control: private, no-store');
    header('Referrer-Policy: no-referrer');
}
$q=db()->prepare("SELECT * FROM panoramas WHERE id=?");$q->execute([$id]);$p=$q->fetch();
if(!$p){http_response_code(404);exit('Asset not found');}
$hotspots=[];$tourScenes=[];$currentIndex=-1;
try{db()->exec('ALTER TABLE tour_scenes ADD COLUMN duration_seconds INTEGER DEFAULT NULL');}catch(Throwable $ignored){}
if($tour&&$sceneId){
    $q=db()->prepare("SELECT h.*,ts.panorama_id target_panorama_id FROM hotspots h LEFT JOIN tour_scenes ts ON ts.id=h.target_scene_id WHERE h.scene_id=?");
    $q->execute([$sceneId]);$hotspots=$q->fetchAll();
    $sql="SELECT ts.id,ts.panorama_id,COALESCE(ts.title,p.title) title,p.image,p.preview,p.description,p.effects,ts.duration_seconds,ts.guided_points,ts.geo_lat,ts.geo_lng FROM tour_scenes ts JOIN panoramas p ON p.id=ts.panorama_id WHERE ts.tour_id=?";
    // A valid embed token grants access to unpublished tour scenes as well.
    $q=db()->prepare($sql.' ORDER BY ts.sort_order,ts.id');
    $q->execute([$tour]);$tourScenes=$q->fetchAll();
    foreach($tourScenes as $i=>$ts)if((int)$ts['id']===$sceneId)$currentIndex=$i;
    if($embedded){
        // Keep portals to unpublished/out-of-scope scenes out of shared tours.
        $allowedScenes=[];
        foreach($tourScenes as $ts)$allowedScenes[(int)$ts['id']]=(int)$ts['panorama_id'];
        $hotspots=array_values(array_filter($hotspots,static function(array $hotspot)use($allowedScenes):bool{
            if($hotspot['type']!=='scene')return true;
            $target=(int)($hotspot['target_scene_id']??0);
            return isset($allowedScenes[$target])&&$allowedScenes[$target]===(int)($hotspot['target_panorama_id']??0);
        }));
    }
}
?>
<!doctype html><html lang="ru"><head>
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="/assets/icons/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title><?=htmlspecialchars($p['title'],ENT_QUOTES,'UTF-8')?> — MiniVR</title>
<link rel="stylesheet" href="/assets/viewer.css?v=<?=filemtime(__DIR__.'/assets/viewer.css')?>">
</head><body class="scene-loading<?=$embedded?' embedded':''?>">
<div id="loader"><div class="loader-ring"></div><b>MINI VR</b><span>LOADING IMMERSIVE SCENE</span></div>
<div id="viewer" data-back="<?=htmlspecialchars($tour?'/tour.php?id='.$tour:'/',ENT_QUOTES,'UTF-8')?>" data-embed-token="<?=htmlspecialchars($embedToken,ENT_QUOTES,'UTF-8')?>" data-effects="<?=htmlspecialchars($p['effects']??'{}',ENT_QUOTES,'UTF-8')?>" data-image="<?=htmlspecialchars($p['image'],ENT_QUOTES,'UTF-8')?>" data-tiles="<?=($p['projection']??'360')==='360'&&($p['stereo']??'mono')==='mono'&&is_file(__DIR__.'/tiles/'.pathinfo((string)$p['image'],PATHINFO_FILENAME).'/manifest.json')?htmlspecialchars('/tiles/'.pathinfo((string)$p['image'],PATHINFO_FILENAME).'/manifest.json',ENT_QUOTES,'UTF-8'):''?>" data-title="<?=htmlspecialchars($p['title'],ENT_QUOTES,'UTF-8')?>" data-projection="<?=htmlspecialchars($p['projection']??'360',ENT_QUOTES,'UTF-8')?>" data-stereo="<?=htmlspecialchars($p['stereo']??'mono',ENT_QUOTES,'UTF-8')?>" data-tour="<?=$tour?>" data-scene="<?=$sceneId?>" data-music-track="<?=(int)(json_decode($p['effects']??'{}',true)['musicTrackId']??0)?>"></div>
<script id="tour-data" type="application/json"><?=json_encode(['scenes'=>$tourScenes,'current'=>$currentIndex,'title'=>$p['title'],'description'=>$p['description']],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_HEX_TAG)?></script>
<script id="hotspots-data" type="application/json"><?=json_encode($hotspots,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_HEX_TAG)?></script>
<div id="top">
<?php if($embedded):?><a href="/viewer.php?id=<?=$id?><?=$tour?'&amp;tour='.$tour.'&amp;scene='.$sceneId:''?>" target="_blank" rel="noopener noreferrer">↗ ОТКРЫТЬ ОТДЕЛЬНО</a>
<?php else:?><a href="<?=htmlspecialchars($tour?'/tour.php?id='.$tour:'/',ENT_QUOTES,'UTF-8')?>">← НАЗАД</a><?php endif;?>
<b><?=htmlspecialchars($p['title'],ENT_QUOTES,'UTF-8')?> · <?=strtoupper(htmlspecialchars($p['projection']??'360',ENT_QUOTES,'UTF-8'))?> <?=strtoupper(htmlspecialchars($p['stereo']??'mono',ENT_QUOTES,'UTF-8'))?></b></div>
<div id="viewer-help"><b>ОСМОТРИТЕСЬ ВОКРУГ</b><span>Перетаскивайте изображение или выберите режим VR</span></div>
<div id="controls">
<?php if(!$embedded):?><button id="offline-save" type="button" title="Сохранить панораму для просмотра без интернета">↓ OFFLINE</button><?php endif;?>
<button id="gyro">GYRO</button><button id="cardboard">▣ CARDBOARD</button><button id="vr">VR</button><button id="full">⛶</button></div>
<div id="hotspot-modal"><button id="hotspot-close">×</button><small id="hotspot-modal-type"></small><h2 id="hotspot-modal-title"></h2><div id="hotspot-modal-content"></div></div><div id="reticle"><i></i></div>
<script src="/assets/vendor/webvr/webvr-polyfill.min.js"></script>
<script>window.__miniVRPolyfill=window.WebVRPolyfill?new window.WebVRPolyfill({ROTATE_INSTRUCTIONS_DISABLED:true,PROVIDE_MOBILE_VRDISPLAY:true}):null;</script>
<script src="/assets/stereo-hotspot-viewer.js?v=<?=filemtime(__DIR__.'/assets/stereo-hotspot-viewer.js')?>"></script>
<script type="module" src="/assets/viewer.js?v=<?=filemtime(__DIR__.'/assets/viewer.js')?>"></script>
<?php if(!$embedded):?><script src="/assets/pwa.js" defer></script><script src="/assets/offline-viewer.js" defer></script><?php endif;?>
<?php require __DIR__.'/assets/music-player.php'; ?></body></html>
