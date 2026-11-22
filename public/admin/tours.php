<?php session_start();require_once __DIR__.'/../../src/db.php';require_once __DIR__.'/../../src/upload.php';require_once __DIR__.'/../../src/guided-scene-points.php';require_once __DIR__.'/../../src/tour-builder.php';require_once __DIR__.'/../../src/tour-geo.php';if(!($_SESSION['admin']??false)){header('Location:/admin/');exit;}$db=db();try{$db->exec('ALTER TABLE tour_scenes ADD COLUMN duration_seconds INTEGER DEFAULT NULL');}catch(Throwable $ignored){}$edit=(int)($_GET['edit']??$_POST['tour_id']??0);
if(!isset($_SESSION['tour_builder_csrf']))$_SESSION['tour_builder_csrf']=bin2hex(random_bytes(32));
if($_SERVER['REQUEST_METHOD']==='POST'&&isset($_POST['toggle_publish'])){
 if(!hash_equals($_SESSION['tour_builder_csrf'],(string)($_POST['csrf_token']??''))){http_response_code(403);exit('Неверный защитный токен');}
 $id=(int)$_POST['toggle_publish'];$q=$db->prepare('UPDATE tours SET published=CASE WHEN published=1 THEN 0 ELSE 1 END WHERE id=?');$q->execute([$id]);header('Location:/admin/tours.php');exit;
}
if($_SERVER['REQUEST_METHOD']==='POST'&&isset($_POST['reorder_scenes'])&&$edit){
 try{
  if(!hash_equals($_SESSION['tour_builder_csrf'],(string)($_POST['csrf_token']??'')))throw new RuntimeException('Сессия устарела. Обновите страницу.');
  saveTourSceneOrder($db,$edit,(string)($_POST['scene_order']??''));
  header('Location:?edit='.$edit.'&reordered=1');exit;
 }catch(Throwable $error){$orderError=$error->getMessage();}
}
if(isset($_GET['delete_scene'])){$q=$db->prepare("DELETE FROM tour_scenes WHERE id=? AND tour_id=?");$q->execute([(int)$_GET['delete_scene'],$edit]);header('Location:?edit='.$edit);exit;}
if(isset($_GET['move'],$edit)&&$edit){$id=(int)$_GET['move'];$dir=$_GET['dir']??'';$q=$db->prepare("SELECT id,sort_order FROM tour_scenes WHERE tour_id=? ORDER BY sort_order,id");$q->execute([$edit]);$rows=$q->fetchAll();foreach($rows as $i=>$r)if((int)$r['id']===$id){$j=$dir==='up'?$i-1:$i+1;if(isset($rows[$j])){$db->beginTransaction();$a=$db->prepare("UPDATE tour_scenes SET sort_order=? WHERE id=?");$a->execute([$rows[$j]['sort_order'],$id]);$a->execute([$r['sort_order'],$rows[$j]['id']]);$db->commit();}break;}header('Location:?edit='.$edit);exit;}
if($_SERVER['REQUEST_METHOD']==='POST'){if(isset($_POST['save_tour'])&&$edit){$cover=$tourRow['cover']??'';if(($_FILES['cover_file']['error']??UPLOAD_ERR_NO_FILE)===UPLOAD_ERR_OK)$cover='/uploads/'.storeUploadedImage($_FILES['cover_file'],UPLOAD_DIR);$q=$db->prepare("UPDATE tours SET title=?,slug=?,description=?,published=?,start_scene_id=?,cover=? WHERE id=?");$slug=preg_replace('/[^a-z0-9]+/','-',strtolower(trim($_POST['slug'])));$q->execute([trim($_POST['title']),$slug,trim($_POST['description']),isset($_POST['published'])?1:0,($_POST['start_scene_id']??'')!==''?(int)$_POST['start_scene_id']:null,$cover,$edit]);header('Location:?edit='.$edit);exit;}if(isset($_POST['save_scene'])&&$edit){
 try{
  $points=parseGuidedScenePoints((string)($_POST['guidedPoints']??'[]'));
  $sceneAudio=parseTourSceneAudio((string)($_POST['scene_audio']??''));
  [$geoLat,$geoLng]=parseTourGeoCoordinates((string)($_POST['geo_lat']??''),(string)($_POST['geo_lng']??''));
  $q=$db->prepare("UPDATE tour_scenes SET title=?,duration_seconds=?,guided_points=?,scene_audio=?,geo_lat=?,geo_lng=? WHERE id=? AND tour_id=?");
  $q->execute([trim($_POST['scene_title']),($_POST['duration_seconds']??'')===''?null:max(0,min(3600,(int)$_POST['duration_seconds'])),json_encode($points,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),$sceneAudio,$geoLat,$geoLng,(int)$_POST['scene_id'],$edit]);
  header('Location:?edit='.$edit);exit;
 }catch(Throwable $error){$sceneError=$error->getMessage();}
}if(isset($_POST['create'])){$slug=preg_replace('/[^a-z0-9]+/','-',strtolower($_POST['slug']?:bin2hex(random_bytes(4))));$q=$db->prepare("INSERT INTO tours(title,slug,description,published) VALUES(?,?,?,1)");$q->execute([trim($_POST['title']),$slug,trim($_POST['description'])]);header('Location:?edit='.$db->lastInsertId());exit;}if(isset($_POST['add_scene'])){$max=(int)$db->query("SELECT COALESCE(MAX(sort_order),0) FROM tour_scenes WHERE tour_id=".$edit)->fetchColumn();$q=$db->prepare("INSERT INTO tour_scenes(tour_id,panorama_id,title,sort_order,guided_points) VALUES(?,?,?,?,'[]')");$q->execute([$edit,(int)$_POST['panorama_id'],trim($_POST['scene_title']),$max+10]);header('Location:?edit='.$edit);exit;}}
$tours=$db->query("SELECT * FROM tours ORDER BY id DESC")->fetchAll();$panos=$db->query("SELECT * FROM panoramas ORDER BY title")->fetchAll();$scenes=[];$tourRow=null;if($edit){$q=$db->prepare("SELECT * FROM tours WHERE id=?");$q->execute([$edit]);$tourRow=$q->fetch();$q=$db->prepare("SELECT s.*,p.image,p.preview,p.title panorama_title,p.projection,p.stereo,(SELECT COUNT(*) FROM hotspots h WHERE h.scene_id=s.id) hotspot_count FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id WHERE s.tour_id=? ORDER BY s.sort_order,s.id");$q->execute([$edit]);$scenes=$q->fetchAll();}?>
<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/admin.css"><title>Экскурсии</title><?php if($edit):?><link rel="stylesheet" href="/assets/vendor/leaflet/leaflet.css?v=<?=filemtime(__DIR__.'/../assets/vendor/leaflet/leaflet.css')?>"><?php endif;?></head><body><aside><div class="logo">MINI<span>VR</span></div><a href="/admin/">◉ Материалы</a><a class="active">◇ Экскурсии</a><a href="/admin/hotspot-import.php">⌖ Привязка точек JSON</a></aside><main><header><div><small>TOUR BUILDER</small><h1><?=$tourRow?htmlspecialchars($tourRow['title']):'Экскурсии'?></h1></div><?php if($tourRow&&$scenes):?><a class="btn" target="_blank" href="/tour.php?id=<?=$edit?>">▶ ПРОСМОТРЕТЬ</a><?php endif;?></header>
<?php if(!$edit):?><div class="tour-admin-grid"><form class="editor" method="post"><input type="hidden" name="create" value="1"><label>Название<input name="title" required></label><label>Slug<input name="slug"></label><label>Описание<textarea name="description"></textarea></label><button class="btn">＋ СОЗДАТЬ ЭКСКУРСИЮ</button></form><div class="tour-list"><?php foreach($tours as $t):?><div style="display:flex;align-items:center;gap:10px"><a class="tour-card" href="?edit=<?=$t['id']?>"><small>TOUR #<?=$t['id']?></small><b><?=htmlspecialchars($t['title'])?></b><span>/<?=htmlspecialchars($t['slug'])?> →</span><small><?=$t['published']?'ОПУБЛИКОВАНА':'СКРЫТА'?></small></a><form method="post"><input type="hidden" name="csrf_token" value="<?=htmlspecialchars($_SESSION['tour_builder_csrf'],ENT_QUOTES)?>"><button name="toggle_publish" value="<?=(int)$t['id']?>" onclick="return confirm('Изменить видимость экскурсии в каталоге? iframe останутся доступны.')"><?=$t['published']?'УБРАТЬ С ПУБЛИКАЦИИ':'ОПУБЛИКОВАТЬ'?></button></form></div><?php endforeach;?></div></div>
<?php else:?><div class="builder-head"><a href="/admin/tours.php">← Все экскурсии</a><span><?=count($scenes)?> сцен</span></div><form class="editor tour-settings" method="post" enctype="multipart/form-data"><input type="hidden" name="tour_id" value="<?=$edit?>"><input type="hidden" name="save_tour" value="1"><h3>Настройки экскурсии</h3><div class="form-columns"><label>Название<input name="title" required value="<?=htmlspecialchars($tourRow['title'])?>"></label><label>Slug<input name="slug" required value="<?=htmlspecialchars($tourRow['slug'])?>"></label></div><label>Обложка экскурсии<input type="file" name="cover_file" accept="image/jpeg,image/png,image/webp"><?php if(!empty($tourRow['cover'])):?><small>Текущая: <?=htmlspecialchars($tourRow['cover'])?></small><?php endif;?></label><label>Описание<textarea name="description" rows="3"><?=htmlspecialchars($tourRow['description'])?></textarea></label><div class="form-columns"><label>Стартовая сцена<select name="start_scene_id"><option value="">Первая по порядку</option><?php foreach($scenes as $ss):?><option value="<?=$ss['id']?>" <?=$tourRow['start_scene_id']==$ss['id']?'selected':''?>><?=htmlspecialchars($ss['title']?:$ss['panorama_title'])?></option><?php endforeach;?></select></label><label class="check"><input type="checkbox" name="published" <?=$tourRow['published']?'checked':''?>> Опубликована</label></div><button class="btn">СОХРАНИТЬ НАСТРОЙКИ</button></form><?php if($tourRow&&$scenes):?>
<section class="editor" style="margin:18px 0;padding:20px;border:1px solid #3a6a7c;border-radius:16px">
<h3>🔗 Ссылка для мгновенного запуска экскурсии</h3>
<p style="opacity:.75">Открывает сразу первую выбранную сцену без страницы описания. На ПК просмотр занимает всё окно, а полноэкранный режим браузера включается по нажатию.</p>
<div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center">
<input id="tour-direct-link" readonly aria-label="Прямая ссылка на экскурсию" style="flex:1;min-width:230px" value="<?=htmlspecialchars((isset($_SERVER['HTTPS'])&&$_SERVER['HTTPS']!=='off'?'https':'http').'://'.($_SERVER['HTTP_HOST']??'localhost').'/tour.php?id='.$edit.'&start=1',ENT_QUOTES)?>">
<button class="btn" type="button" id="tour-copy-link">⧉ КОПИРОВАТЬ ССЫЛКУ</button>
<a class="btn" target="_blank" rel="noopener" href="/tour.php?id=<?=$edit?>&start=1">▶ ПРОВЕРИТЬ</a>
</div><small id="tour-copy-status" aria-live="polite"></small>
</section>
<script>
document.getElementById('tour-copy-link')?.addEventListener('click',async()=>{
 const field=document.getElementById('tour-direct-link'),status=document.getElementById('tour-copy-status');
 try{await navigator.clipboard.writeText(field.value);status.textContent='Ссылка скопирована';}
 catch(_){field.select();status.textContent='Выделите ссылку и скопируйте вручную (Ctrl+C)';}
});
</script>
<?php endif;?>
<?php if($tourRow&&$scenes):?>
<section class="editor" data-minivr-export data-tour="<?=$edit?>" data-scenes="<?=htmlspecialchars(json_encode(array_map(static fn($s)=>['image'=>$s['image'],'projection'=>$s['projection'],'stereo'=>$s['stereo'],'duration_seconds'=>$s['duration_seconds']??10],$scenes),JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE),ENT_QUOTES,'UTF-8')?>" style="margin:18px 0;padding:20px;border:1px solid #3a6a7c;border-radius:16px">
<h3>🎬 Экспорт экскурсии в видео 360°</h3>
<p>Запись в браузере из исходных эквиректангулярных панорам 2:1. Вкладка должна оставаться активной до завершения. Экспортируется изображение и переходы; интерактивные точки, эффекты и звук пока не включаются.</p>
<div class="form-columns">
<label>Разрешение<select id="export-quality"><option value="1920x960">1920×960</option><option value="3840x1920">3840×1920 (4K по ширине)</option></select></label>
<label>Частота кадров<select id="export-fps"><option value="30">30 FPS</option><option value="24">24 FPS</option></select></label>
<label>Переход между сценами<select id="export-fade"><option value="0">Без перехода</option><option value="1" selected>Плавный 1 с</option><option value="2">Плавный 2 с</option></select></label>
</div>
<?php $exportTracks=$db->query("SELECT title,artist,file_path FROM music_tracks WHERE is_active=1 ORDER BY sort_order,id")->fetchAll(); ?>
<div class="form-columns"><label>Музыка для видео<select id="export-music"><option value="">Без музыки</option><?php foreach($exportTracks as $track):?><option value="<?=htmlspecialchars($track['file_path'],ENT_QUOTES,'UTF-8')?>"><?=htmlspecialchars($track['title'].' — '.$track['artist'])?></option><?php endforeach;?></select></label><label>Громкость музыки, %<input type="number" id="export-volume" value="70" min="0" max="100"></label></div>
<p>Музыка повторяется до конца видео. Для YouTube используйте композиции с правами на публикацию.</p>
<canvas width="960" height="480" style="width:100%;max-width:480px;aspect-ratio:2/1;background:#000;border-radius:10px"></canvas>
<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"><button class="btn" type="button" id="export-start">▶ СОЗДАТЬ ВИДЕО 360°</button><button class="btn" type="button" id="export-stop" disabled>■ ЗАВЕРШИТЬ</button></div>
<p id="export-status" role="status" aria-live="polite">MP4 сохраняется, если браузер поддерживает его запись; иначе WebM. Для MP4 метаданные 360° добавляются автоматически. WebM пока экспортируется без пространственных метаданных.</p>
</section>
<script src="/assets/mp4-spherical.js?v=<?=filemtime(__DIR__.'/../assets/mp4-spherical.js')?>" defer></script>
<script src="/assets/tour-export.js?v=<?=filemtime(__DIR__.'/../assets/tour-export.js')?>" defer></script>
<?php endif;?>
<?php if(!empty($orderError)):?><p role="alert" class="tour-builder-error"><?=htmlspecialchars($orderError,ENT_QUOTES,'UTF-8')?></p><?php endif;?>
<?php if($scenes):?>
<section class="editor tour-storyboard" id="tour-storyboard" aria-labelledby="tour-storyboard-heading">
 <div class="tour-storyboard-heading"><div><small>ШАГ 1 / МАРШРУТ</small><h2 id="tour-storyboard-heading">Конструктор экскурсии</h2><p>Перетащите сцены в нужном порядке или используйте стрелки на телефоне. Сохранение порядка не изменяет точки, озвучку и настройки панорам.</p></div><span class="tour-storyboard-count"><?=count($scenes)?> сцен</span></div>
 <form method="post" class="tour-order-form" data-tour-order-form>
  <input type="hidden" name="tour_id" value="<?=$edit?>"><input type="hidden" name="reorder_scenes" value="1"><input type="hidden" name="csrf_token" value="<?=htmlspecialchars($_SESSION['tour_builder_csrf'],ENT_QUOTES,'UTF-8')?>">
  <input type="hidden" name="scene_order" value="<?=htmlspecialchars(json_encode(array_map('intval',array_column($scenes,'id'))),ENT_QUOTES,'UTF-8')?>" data-scene-order>
  <ol class="tour-storyboard-list" data-tour-order-list>
   <?php foreach($scenes as $i=>$s):$storedPoints=json_decode((string)($s['guided_points']??'[]'),true);$guidedCount=is_array($storedPoints)?count($storedPoints):0;$isStart=!empty($tourRow['start_scene_id'])?(int)$tourRow['start_scene_id']===(int)$s['id']:$i===0;?>
   <li class="tour-storyboard-item" data-scene-id="<?=(int)$s['id']?>" draggable="true">
    <span class="tour-storyboard-handle" title="Перетащить сцену" aria-hidden="true">⠿</span>
    <span class="tour-storyboard-number" data-scene-number><?=str_pad((string)($i+1),2,'0',STR_PAD_LEFT)?></span>
    <img class="tour-storyboard-thumb" src="<?=htmlspecialchars((string)($s['preview']?:$s['image']),ENT_QUOTES,'UTF-8')?>" loading="lazy" alt="">
    <div class="tour-storyboard-description"><strong><?=htmlspecialchars((string)($s['title']?:$s['panorama_title']),ENT_QUOTES,'UTF-8')?></strong><small><?=htmlspecialchars(strtoupper($s['projection'].' · '.$s['stereo']),ENT_QUOTES,'UTF-8')?> · <?=($s['duration_seconds']??'')===''?'Время из панорамы':(int)$s['duration_seconds'].' с'?> · <?=$guidedCount?> точек рассказа<?=$isStart?' · СТАРТ':''?></small></div>
    <div class="tour-storyboard-actions"><a href="#scene-edit-<?=(int)$s['id']?>" data-edit-scene>Настроить</a><a href="/viewer.php?id=<?=(int)$s['panorama_id']?>&amp;tour=<?=$edit?>&amp;scene=<?=(int)$s['id']?>" target="_blank" rel="noopener" title="Просмотреть эту сцену">▶</a><button type="button" data-order-up aria-label="Поднять сцену">↑</button><button type="button" data-order-down aria-label="Опустить сцену">↓</button></div>
   </li>
   <?php endforeach;?>
  </ol>
  <div class="tour-order-footer"><button class="btn" type="submit" data-order-save disabled>СОХРАНИТЬ ПОРЯДОК</button><span data-order-status role="status" aria-live="polite"><?php if(isset($_GET['reordered'])):?>Порядок сцен сохранён.<?php else:?>Измените порядок сцен, чтобы сохранить.<?php endif;?></span></div>
 </form>
</section>
<?php endif;?>
<h2 class="tour-builder-subtitle">Шаг 2. Настройка сцен</h2>
<?php if(!empty($sceneError)):?><p role="alert" style="color:#ffb0a0"><?=htmlspecialchars($sceneError,ENT_QUOTES)?></p><?php endif;?><div class="scene-grid"><?php foreach($scenes as $i=>$s):?><article class="scene-card" id="scene-edit-<?=(int)$s['id']?>"><div class="scene-preview" style="background-image:url('<?=htmlspecialchars($s['preview']?:$s['image'])?>')"><span><?=strtoupper($s['projection'])?> · <?=strtoupper($s['stereo'])?></span><b><?=str_pad((string)($i+1),2,'0',STR_PAD_LEFT)?></b></div><div class="scene-body"><form method="post" class="scene-title-form scene-narration-form"><input type="hidden" name="tour_id" value="<?=$edit?>"><input type="hidden" name="save_scene" value="1"><input type="hidden" name="scene_id" value="<?=$s['id']?>"><input name="scene_title" value="<?=htmlspecialchars($s['title']?:$s['panorama_title'])?>" aria-label="Название сцены"><label class="scene-duration">Секунд <input type="number" name="duration_seconds" min="0" max="3600" style="width:85px" placeholder="Из панорамы" value="<?=htmlspecialchars((string)($s['duration_seconds']??''))?>"></label>
<div class="scene-audio-guide" data-scene-audio-editor>
 <strong>🎧 Основной аудиокомментарий панорамы</strong>
 <small>Звучит при открытии этой сцены. Если в точке рассказа есть своё аудио, основной голос приостанавливается, а после него продолжается.</small>
 <input type="hidden" name="scene_audio" value="<?=htmlspecialchars((string)($s['scene_audio']??''),ENT_QUOTES,'UTF-8')?>" data-scene-audio-value>
 <div class="scene-audio-guide-controls"><input type="file" accept=".mp3,.ogg,.wav,audio/*" data-scene-audio-file aria-label="Загрузить аудиокомментарий сцены"><button type="button" data-scene-audio-clear>Убрать</button></div>
 <audio controls preload="metadata" data-scene-audio-preview <?php if(empty($s['scene_audio'])):?>hidden<?php else:?>src="<?=htmlspecialchars((string)$s['scene_audio'],ENT_QUOTES,'UTF-8')?>"<?php endif;?>></audio>
 <small data-scene-audio-status role="status" aria-live="polite">MP3 / OGG / WAV, до 20 МБ. После загрузки нажмите «Сохранить сцену».</small>
</div>
<details class="scene-guided-details"><summary>🎙 Повороты, текст и аудио этой сцены</summary>
<div data-guided-editor data-image="<?=htmlspecialchars((string)$s['image'],ENT_QUOTES)?>">
<img data-guided-image alt="Указать направление на панораме" style="display:block;width:100%;aspect-ratio:2/1;object-fit:fill;cursor:crosshair;border-radius:8px;background:#183747">
<small>Нажмите на изображение, чтобы указать точку взгляда. Порядок и звуки сохраняются только для этой сцены экскурсии.</small>
<div data-guided-list></div><button type="button" data-guided-add>＋ Добавить точку</button>
<input type="hidden" name="guidedPoints" value="<?=htmlspecialchars((string)($s['guided_points']??'[]'),ENT_QUOTES)?>">
</div></details>
<div class="scene-location-details" data-tour-geo-scope>
 <strong>📍 Место панорамы</strong>
 <input name="geo_lat" type="hidden" value="<?=htmlspecialchars((string)($s['geo_lat']??''),ENT_QUOTES,'UTF-8')?>">
 <input name="geo_lng" type="hidden" value="<?=htmlspecialchars((string)($s['geo_lng']??''),ENT_QUOTES,'UTF-8')?>">
 <div class="scene-geo-actions">
  <button type="button" data-tour-geo-open>🗺 Выбрать на карте</button>
  <button type="button" data-tour-geo-clear>Убрать точку</button>
 </div>
 <output data-tour-geo-status aria-live="polite"><?php if($s['geo_lat']!==null&&$s['geo_lng']!==null):?><?=htmlspecialchars((string)$s['geo_lat'].'°, '.(string)$s['geo_lng'].'°',ENT_QUOTES,'UTF-8')?><?php else:?>Место ещё не указано<?php endif;?></output>
 <a data-tour-geo-view href="https://www.openstreetmap.org/?mlat=<?=rawurlencode((string)($s['geo_lat']??''))?>&amp;mlon=<?=rawurlencode((string)($s['geo_lng']??''))?>" target="_blank" rel="noopener noreferrer" <?php if($s['geo_lat']===null||$s['geo_lng']===null):?>hidden<?php endif;?>>Проверить на карте ↗</a>
 <small>После выбора точки нажмите «Сохранить сцену».</small>
</div>
<button class="scene-save-button" title="Сохранить сцену, координаты и точки">✓ СОХРАНИТЬ СЦЕНУ</button></form>
<small><?=$s['hotspot_count']?> HOTSPOTS<?=$tourRow['start_scene_id']==$s['id']?' · START':''?></small>
<div class="scene-actions"><a href="?edit=<?=$edit?>&move=<?=$s['id']?>&dir=up">↑</a><a href="?edit=<?=$edit?>&move=<?=$s['id']?>&dir=down">↓</a><a href="/admin/hotspots.php?scene=<?=$s['id']?>">ТОЧКИ</a><a class="danger" onclick="return confirm('Удалить сцену?')" href="?edit=<?=$edit?>&delete_scene=<?=$s['id']?>">×</a></div>
</div></article><?php endforeach;?></div>
<form class="editor add-scene" method="post" id="tour-add-scene"><input type="hidden" name="add_scene" value="1"><input type="hidden" name="tour_id" value="<?=$edit?>">
<h3>Шаг 3. Добавить панораму</h3><p class="tour-builder-hint">Выберите готовый VR-материал. Одна панорама может использоваться в нескольких экскурсиях с разными рассказами.</p>
<label>Поиск панорамы<input type="search" data-pano-search placeholder="Название панорамы" autocomplete="off"></label>
<div class="tour-pano-picker" data-pano-picker><?php foreach($panos as $p):?>
 <button type="button" class="tour-pano-option" data-pano-id="<?=(int)$p['id']?>" data-pano-title="<?=htmlspecialchars((string)$p['title'],ENT_QUOTES,'UTF-8')?>"><img src="<?=htmlspecialchars((string)($p['preview']?:$p['image']),ENT_QUOTES,'UTF-8')?>" alt="" loading="lazy"><span><?=htmlspecialchars((string)$p['title'],ENT_QUOTES,'UTF-8')?><small><?=htmlspecialchars(strtoupper($p['projection'].' · '.$p['stereo']),ENT_QUOTES,'UTF-8')?></small></span></button>
<?php endforeach;?></div>
<label>VR-материал<select name="panorama_id" data-pano-select required><?php foreach($panos as $p):?><option value="<?=$p['id']?>"><?=htmlspecialchars($p['title'])?> — <?=strtoupper($p['projection'])?> <?=strtoupper($p['stereo'])?></option><?php endforeach;?></select></label>
<label>Название сцены<input name="scene_title" placeholder="Можно оставить пустым"></label><button class="btn" <?=$panos?'':'disabled'?>>＋ ДОБАВИТЬ СЦЕНУ</button></form>
<?php endif;?></main>
<?php if($edit):?>
<section class="tour-geo-picker-overlay" id="tour-geo-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="tour-geo-picker-heading" hidden>
 <div class="tour-geo-picker-panel">
  <header class="tour-geo-picker-heading"><div><small>GEOLOCATION</small><h2 id="tour-geo-picker-heading">Выберите точку на карте</h2></div><button type="button" id="tour-geo-picker-close" aria-label="Закрыть карту">×</button></header>
  <p>Найдите место панорамы, нажмите на карте — появится маркер. Его можно перетащить для уточнения.</p>
  <div id="tour-geo-picker-map" aria-label="Интерактивная карта для выбора координат"></div>
  <div class="tour-geo-picker-location"><output id="tour-geo-picker-coordinates" aria-live="polite">Точка не выбрана</output><div><button type="button" id="tour-geo-picker-center">📍 Точка в центре карты</button><button type="button" id="tour-geo-picker-near">◎ Моё местоположение</button></div></div>
  <div class="tour-geo-picker-actions"><button type="button" id="tour-geo-picker-cancel">Отмена</button><button type="button" id="tour-geo-picker-apply" disabled>✓ Применить точку</button></div>
  <small>Используется OpenStreetMap. Координаты записываются в сцену после нажатия «Сохранить сцену».</small>
 </div>
</section>
<script src="/assets/vendor/leaflet/leaflet.js?v=<?=filemtime(__DIR__.'/../assets/vendor/leaflet/leaflet.js')?>" defer></script>
<script src="/assets/tour-geo-picker.js?v=<?=filemtime(__DIR__.'/../assets/tour-geo-picker.js')?>" defer></script>
<?php endif;?>
<script src="/assets/scene-audio-editor.js?v=<?=filemtime(__DIR__.'/../assets/scene-audio-editor.js')?>" defer></script><script src="/assets/guided-points-editor.js?v=<?=filemtime(__DIR__.'/../assets/guided-points-editor.js')?>" defer></script><script src="/assets/tour-builder.js?v=<?=filemtime(__DIR__.'/../assets/tour-builder.js')?>" defer></script></body></html>
