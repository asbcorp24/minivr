<?php
declare(strict_types=1);
session_start();
require_once __DIR__.'/../../src/db.php';
require_once __DIR__.'/../../src/panorama-thumbnails.php';
require_once __DIR__.'/../../src/panorama-cleanup.php';

if (!($_SESSION['admin'] ?? false)) { header('Location:/admin/'); exit; }
if (empty($_SESSION['panorama_gallery_csrf'])) $_SESSION['panorama_gallery_csrf']=bin2hex(random_bytes(32));
$db=db();
$message='';
$error='';

if ($_SERVER['REQUEST_METHOD']==='POST') {
    if (!hash_equals($_SESSION['panorama_gallery_csrf'], (string)($_POST['csrf'] ?? ''))) {
        http_response_code(403); exit('Неверный защитный токен');
    }
    $id=(int)($_POST['id'] ?? 0);
    $action=(string)($_POST['action'] ?? '');
    $find=$db->prepare('SELECT id,title,description,image FROM panoramas WHERE id=?');
    $find->execute([$id]);
    $current=$find->fetch();
    if (!$current) { http_response_code(404); exit('Панорама не найдена'); }

    if ($action==='save') {
        $title=trim((string)($_POST['title'] ?? ''));
        $description=trim((string)($_POST['description'] ?? ''));
        if ($title==='' || mb_strlen($title)>300) {
            $error='Название должно содержать от 1 до 300 символов.';
        } elseif (mb_strlen($description)>4000) {
            $error='Описание не должно превышать 4000 символов.';
        } else {
            $q=$db->prepare('UPDATE panoramas SET title=?, description=? WHERE id=?');
            $q->execute([$title,$description,$id]);
            header('Location:/admin/gallery.php?id='.$id.'&saved=1'); exit;
        }
    } elseif ($action==='delete') {
        $image=(string)$current['image'];
        try {
            $db->beginTransaction();
            $sceneQ=$db->prepare('SELECT id FROM tour_scenes WHERE panorama_id=?');
            $sceneQ->execute([$id]);
            $sceneIds=array_map('intval',$sceneQ->fetchAll(PDO::FETCH_COLUMN));
            if ($sceneIds) {
                $marks=implode(',',array_fill(0,count($sceneIds),'?'));
                $db->prepare("UPDATE tours SET start_scene_id=NULL WHERE start_scene_id IN ($marks)")->execute($sceneIds);
                $db->prepare("DELETE FROM hotspots WHERE scene_id IN ($marks)")->execute($sceneIds);
                $db->prepare("DELETE FROM tour_scenes WHERE id IN ($marks)")->execute($sceneIds);
            }
            $db->prepare("DELETE FROM embed_links WHERE kind='panorama' AND target_id=?")->execute([$id]);
            $db->prepare('DELETE FROM panoramas WHERE id=?')->execute([$id]);
            $db->commit();
            panoramaRemoveUnreferenced($db,$image);
            header('Location:/admin/gallery.php?deleted=1'); exit;
        } catch (Throwable $e) {
            if ($db->inTransaction()) $db->rollBack();
            error_log('MiniVR panorama gallery delete: '.$e->getMessage());
            $error='Не удалось удалить панораму. Проверьте журнал ошибок сервера.';
        }
    } else {
        http_response_code(400); exit('Неизвестное действие');
    }
}

if (isset($_GET['saved'])) $message='Изменения сохранены.';
if (isset($_GET['deleted'])) $message='Панорама удалена.';
$panos=$db->query('SELECT id,title,description,image,preview,published,projection,stereo FROM panoramas ORDER BY id DESC')->fetchAll();
$count=count($panos);
$selectedId=(int)($_GET['id'] ?? ($panos[0]['id'] ?? 0));
$selectedIndex=0;
foreach($panos as $i=>$p){if((int)$p['id']===$selectedId){$selectedIndex=$i;break;}}
if($count && !isset($panos[$selectedIndex]) || ($count && (int)$panos[$selectedIndex]['id']!==$selectedId)) $selectedIndex=0;
$selected=$panos[$selectedIndex] ?? null;
function galleryH(string $value): string { return htmlspecialchars($value,ENT_QUOTES|ENT_SUBSTITUTE,'UTF-8'); }
?>
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Галерея панорам — MiniVR</title><link rel="stylesheet" href="/assets/admin.css">
<style>
.gallery-wrap{max-width:1250px;margin:0 auto}
.gallery-head{display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;margin-bottom:24px}
.gallery-head h1{margin:5px 0}.gallery-count{color:#82a5b2;font:12px monospace}
.carousel{position:relative;border:1px solid #1b4051;background:#050d14;border-radius:12px;overflow:hidden}
.stage{height:min(57vh,600px);min-height:260px;display:grid;place-items:center;background:radial-gradient(ellipse,#102632,#020609);position:relative}
.stage img{display:block;max-width:100%;max-height:100%;width:100%;height:100%;object-fit:contain}
.stage-empty{color:#6e8b97}
.nav-arrow{position:absolute;z-index:3;top:50%;transform:translateY(-50%);width:48px;height:64px;padding:0;border:1px solid #4b8998;background:#061923e8;border-radius:8px;font:30px sans-serif;color:#baf8ff}
.nav-arrow.prev{left:14px}.nav-arrow.next{right:14px}.nav-arrow:disabled{opacity:.25;cursor:not-allowed}
.carousel-meta{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;border-top:1px solid #153342;color:#85a5b1;font:11px monospace;gap:12px;flex-wrap:wrap}
.gallery-editor{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,420px);gap:22px;margin-top:22px;align-items:start}
.gallery-form{display:grid;gap:15px;padding:22px;background:#07121c;border:1px solid #163344;border-radius:10px}
.gallery-form label{display:grid;gap:8px;color:#9ab4be}
.gallery-form input,.gallery-form textarea{font:15px system-ui}
.gallery-form textarea{min-height:170px;resize:vertical;line-height:1.5}
.gallery-actions{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.gallery-delete{background:#521f2a;border-color:#a94b5c}
.gallery-side{padding:20px;border:1px solid #163344;background:#07121c;border-radius:10px;color:#819eaa;line-height:1.6}
.gallery-side a{color:#65eaff;text-decoration:none}
.gallery-dots{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;padding:12px}
.gallery-dot{width:8px;height:8px;padding:0;border:0;border-radius:50%;background:#31505d}
.gallery-dot.active{background:#50eaff;box-shadow:0 0 10px #50eaff88}
.gallery-notice{padding:12px 15px;margin-bottom:16px;border:1px solid #28745d;background:#0b261f;color:#a6f5d8}
.gallery-error{padding:12px 15px;margin-bottom:16px;border:1px solid #8e3946;background:#32151c;color:#ffc2cb}
@media(max-width:850px){.gallery-editor{grid-template-columns:1fr}.stage{height:48vh;min-height:240px}}
@media(max-width:560px){main{padding:22px 4vw}.nav-arrow{width:40px;height:54px}.gallery-form{padding:16px}.gallery-actions>*{flex:1}.gallery-actions button{min-height:46px}}
</style>
</head>
<body>
<aside><div class="logo">MINI<span>VR</span></div>
<a href="/admin/">◉ Панорамы</a><a class="active" href="/admin/gallery.php">▣ Галерея рисунков</a>
<a href="/admin/tours.php">◇ Экскурсии</a><a href="/admin/hotspot-import.php">⌖ Привязка точек JSON</a>
<a href="/admin/embeds.php">⇧ Встраивание</a><a href="/admin/music.php">♫ Музыка</a><a href="/admin/models.php">✦ Нейросети</a>
<a href="/admin/cleanup.php">♻ Очистка файлов</a><a href="/">↗ Открыть сайт</a><a href="/admin/?logout=1">⏻ Выход</a></aside>
<main><div class="gallery-wrap">
<div class="gallery-head"><div><small>CONTENT LIBRARY</small><h1>Галерея рисунков</h1><div class="gallery-count">Просмотр и редактирование панорам</div></div><div class="gallery-actions"><a class="btn" href="/admin/panorama.php">＋ ЗАГРУЗИТЬ</a><span class="gallery-count"><?= $count ?> изображений</span></div></div>
<?php if($message):?><div class="gallery-notice" role="status"><?=galleryH($message)?></div><?php endif;?>
<?php if($error):?><div class="gallery-error" role="alert"><?=galleryH($error)?></div><?php endif;?>
<?php if(!$selected):?>
<div class="gallery-side"><h2>Пока нет изображений</h2><p>Загрузи первую панораму — она появится здесь.</p><a href="/admin/panorama.php">Загрузить изображение →</a></div>
<?php else:?>
<section class="carousel" aria-label="Карусель изображений">
<div class="stage">
<img id="gallery-image" src="<?=galleryH(panoramaThumbnailUrl((string)($selected['image'] ?? ''),'large') ?: (string)$selected['image'])?>" alt="<?=galleryH((string)$selected['title'])?>">
<button class="nav-arrow prev" type="button" aria-label="Предыдущее изображение" id="gallery-prev">‹</button>
<button class="nav-arrow next" type="button" aria-label="Следующее изображение" id="gallery-next">›</button>
</div>
<div class="carousel-meta"><span id="gallery-title"><?=galleryH((string)$selected['title'])?></span><span id="gallery-position"><?=($selectedIndex+1)?> / <?=$count?></span><span><?=((int)$selected['published']===1)?'ОПУБЛИКОВАНО':'СКРЫТО'?></span></div>
<div class="gallery-dots" id="gallery-dots" aria-label="Выбор изображения"></div>
</section>
<div class="gallery-editor">
<form class="gallery-form" method="post" action="/admin/gallery.php">
<input type="hidden" name="csrf" value="<?=galleryH($_SESSION['panorama_gallery_csrf'])?>">
<input type="hidden" name="id" value="<?=(int)$selected['id']?>">
<input type="hidden" name="action" value="save">
<div><small>РЕДАКТИРОВАНИЕ</small><h2 style="margin:5px 0 0">Название и описание</h2></div>
<label>Название<input name="title" maxlength="300" required value="<?=galleryH((string)$selected['title'])?>"></label>
<label>Описание<textarea name="description" maxlength="4000" placeholder="Описание изображения..."><?=galleryH((string)$selected['description'])?></textarea></label>
<div class="gallery-actions"><button type="submit">СОХРАНИТЬ ИЗМЕНЕНИЯ</button><a class="btn" href="/viewer.php?id=<?=(int)$selected['id']?>" target="_blank" rel="noopener">ОТКРЫТЬ ПРОСМОТР</a></div>
</form>
<div class="gallery-side"><small>ДЕЙСТВИЯ С ИЗОБРАЖЕНИЕМ</small><h3><?=galleryH((string)$selected['title'])?></h3>
<p>Формат: <?=galleryH((string)$selected['projection'])?> · <?=galleryH((string)$selected['stereo'])?></p>
<p>Удаление убирает панораму из каталога и экскурсий. Если исходный файл больше нигде не используется, он также удаляется с сервера.</p>
<form method="post" action="/admin/gallery.php" onsubmit="return confirm('Удалить эту панораму? Она также будет удалена из связанных экскурсий. Это действие нельзя отменить.')">
<input type="hidden" name="csrf" value="<?=galleryH($_SESSION['panorama_gallery_csrf'])?>">
<input type="hidden" name="id" value="<?=(int)$selected['id']?>">
<input type="hidden" name="action" value="delete">
<button class="gallery-delete" type="submit">УДАЛИТЬ ИЗОБРАЖЕНИЕ</button>
</form>
</div></div>
<script>
const galleryItems=<?=json_encode(array_map(static fn($p)=>[
 'id'=>(int)$p['id'],
 'title'=>(string)$p['title'],
 'src'=>panoramaThumbnailUrl((string)$p['image'],'large') ?: (string)$p['image'],
 'published'=>(int)$p['published']===1
],$panos),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_HEX_TAG|JSON_HEX_APOS|JSON_HEX_AMP|JSON_HEX_QUOT)?>;
let galleryIndex=<?=$selectedIndex?>;
const image=document.getElementById('gallery-image'),title=document.getElementById('gallery-title'),position=document.getElementById('gallery-position'),prev=document.getElementById('gallery-prev'),next=document.getElementById('gallery-next'),dots=document.getElementById('gallery-dots');
function showGalleryItem(index,updateUrl=true){
 if(!galleryItems.length)return;
 galleryIndex=(index+galleryItems.length)%galleryItems.length;
 const item=galleryItems[galleryIndex];
 image.src=item.src;image.alt=item.title;title.textContent=item.title;
 position.textContent=(galleryIndex+1)+' / '+galleryItems.length;
 prev.disabled=galleryItems.length<2;next.disabled=galleryItems.length<2;
 [...dots.children].forEach((dot,i)=>dot.classList.toggle('active',i===galleryIndex));
 if(updateUrl)history.replaceState(null,'','/admin/gallery.php?id='+item.id);
}
galleryItems.forEach((item,i)=>{const dot=document.createElement('button');dot.type='button';dot.className='gallery-dot'+(i===galleryIndex?' active':'');dot.setAttribute('aria-label','Изображение '+(i+1));dot.title=item.title;dot.addEventListener('click',()=>showGalleryItem(i));dots.append(dot);});
prev.addEventListener('click',()=>showGalleryItem(galleryIndex-1));next.addEventListener('click',()=>showGalleryItem(galleryIndex+1));
document.addEventListener('keydown',e=>{if(e.target.matches('input,textarea,button'))return;if(e.key==='ArrowLeft')showGalleryItem(galleryIndex-1);if(e.key==='ArrowRight')showGalleryItem(galleryIndex+1);});
let touchX=null;image.addEventListener('touchstart',e=>{touchX=e.changedTouches[0].clientX},{passive:true});image.addEventListener('touchend',e=>{if(touchX===null)return;const dx=e.changedTouches[0].clientX-touchX;if(Math.abs(dx)>45)showGalleryItem(galleryIndex+(dx<0?1:-1));touchX=null},{passive:true});
showGalleryItem(galleryIndex,false);
</script>
<?php endif;?>
</div></main></body></html>
