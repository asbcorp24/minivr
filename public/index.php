<?php
require_once __DIR__.'/../src/db.php';
require_once __DIR__.'/../src/panorama-thumbnails.php';
require_once __DIR__.'/../src/home-gallery.php';
$db=db();
$toursGallery=homeGalleryPage($db,'tours',$_GET['tours_page']??1);
$materialsGallery=homeGalleryPage($db,'materials',$_GET['materials_page']??1);

// The same server-rendered cards serve full navigation and no-reload pagination.
$fragment=(string)($_GET['gallery_fragment']??'');
if(in_array($fragment,['tours','materials'],true)){
    header('Content-Type: text/html; charset=utf-8');
    header('Cache-Control: private, no-store');
    $galleryType=$fragment;
    $gallery=$galleryType==='tours'?$toursGallery:$materialsGallery;
    require __DIR__.'/../src/home-gallery-view.php';
    exit;
}

$db->exec("CREATE TABLE IF NOT EXISTS music_tracks (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,artist TEXT NOT NULL DEFAULT '',file_path TEXT NOT NULL,sort_order INTEGER NOT NULL DEFAULT 0,is_active INTEGER NOT NULL DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
$tracks=$db->query("SELECT title,artist,file_path FROM music_tracks WHERE is_active=1 ORDER BY sort_order,id")->fetchAll();
?>
<!doctype html>
<html lang="ru"><head>
<link rel="manifest" href="/manifest.webmanifest"><link rel="icon" type="image/svg+xml" href="/assets/icons/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#03070d">
<title>MiniVR — immersive gallery</title>
<link rel="stylesheet" href="/assets/app.css?v=<?=filemtime(__DIR__.'/assets/app.css')?>">
<style>
.music-player{position:fixed;z-index:1000;right:18px;bottom:18px;display:flex;align-items:center;gap:10px;max-width:calc(100vw - 36px);padding:12px 16px;border:1px solid #36738d;border-radius:18px;background:#071824ee;color:#fff;box-shadow:0 12px 36px #0009;backdrop-filter:blur(14px)}
.music-player button{background:#153849;color:#fff;border:1px solid #43849d;border-radius:50%;width:38px;height:38px;cursor:pointer}
.music-player .music-toggle{background:#00a9ce;color:#00141d}
.music-meta{display:flex;flex-direction:column;min-width:110px;max-width:220px;overflow:hidden}
.music-title,.music-artist{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.music-artist{color:#9fc2ce}
@media(max-width:600px){.music-player{right:8px;bottom:8px;padding:8px;gap:5px}.music-player button{width:34px;height:34px}.music-meta{max-width:110px}}
</style>
</head><body>
<canvas id="space"></canvas>
<header><a class="brand" href="/">MINI<span>VR</span></a><nav id="main-nav"><a href="#tours">ЭКСКУРСИИ</a><a href="#panoramas">VR-МАТЕРИАЛЫ</a></nav><button class="nav-toggle" id="nav-toggle" aria-label="Меню">☰</button><div class="device-badge" id="device-badge">WEB VIEW</div></header>
<main><section class="hero"><div class="hero-copy"><div class="eyebrow">IMMERSIVE DIGITAL SPACE / WEBXR</div><h1>Окажитесь<br><em>внутри истории.</em></h1><p>Виртуальные пространства, стереофотографии и панорамы 180°/360°. Откройте на экране, вставьте телефон в Cardboard или войдите через VR-гарнитуру.</p><div class="hero-actions"><a class="primary" href="#tours">ВЫБРАТЬ ЭКСКУРСИЮ →</a><a class="ghost" href="#panoramas">СМОТРЕТЬ МАТЕРИАЛЫ</a></div></div><div class="orb"><div><b>360°</b><span>LOOK AROUND</span></div></div></section>
<section id="tours" class="journeys" data-gallery="tours" data-gallery-page="<?=$toursGallery['page']?>">
 <div class="section-title"><small>01 / JOURNEYS</small><h2>Виртуальные экскурсии</h2><p>Последовательности связанных пространств с интерактивными переходами.</p></div>
 <?php $galleryType='tours';$gallery=$toursGallery;require __DIR__.'/../src/home-gallery-view.php';?>
 <p class="gallery-status" data-gallery-status role="status" aria-live="polite" hidden></p>
</section>
<section id="panoramas" data-gallery="materials" data-gallery-page="<?=$materialsGallery['page']?>">
 <div class="section-title"><small>02 / EXPLORE</small><h2>VR-материалы</h2><p>Отдельные панорамы и стереоизображения.</p></div>
 <?php $galleryType='materials';$gallery=$materialsGallery;require __DIR__.'/../src/home-gallery-view.php';?>
 <p class="gallery-status" data-gallery-status role="status" aria-live="polite" hidden></p>
</section></main><footer><span>MINIVR / IMMERSIVE PLATFORM</span><span>DESKTOP · MOBILE · CARDBOARD · WEBXR</span><a href="/admin/">ADMIN</a></footer><script type="module" src="/assets/home.js"></script><script src="/assets/home-galleries.js?v=<?=filemtime(__DIR__.'/assets/home-galleries.js')?>" defer></script><script src="/assets/pwa.js" defer></script><?php require __DIR__.'/assets/music-player.php'; ?></body></html>
