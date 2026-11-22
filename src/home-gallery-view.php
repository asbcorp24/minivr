<?php
// Required context: $galleryType, $gallery, $toursGallery, $materialsGallery.
$galleryLabel = $galleryType === 'tours' ? 'экскурсий' : 'материалов';
$tourPage = $toursGallery['page'];
$materialsPage = $materialsGallery['page'];
?>
<div class="gallery-results" data-gallery-results data-page="<?=$gallery['page']?>">
 <?php if($galleryType==='tours'):?>
  <div class="tour-grid">
   <?php foreach($gallery['items'] as $i=>$t):
    $cover = $t['cover'] ? panoramaThumbnailUrl($t['cover'],'card') : ($t['fallback_cover'] ? panoramaThumbnailUrl($t['fallback_cover'],'card') : '');
   ?>
   <a class="tour-card <?=($i===0&&$gallery['page']===1)?'featured':''?>" href="/tour.php?id=<?=(int)$t['id']?>">
    <div class="tour-image" style="background-image:url('<?=htmlspecialchars($cover,ENT_QUOTES,'UTF-8')?>')">
     <span class="tour-no"><?=str_pad((string)($gallery['offset']+$i+1),2,'0',STR_PAD_LEFT)?></span>
     <span class="tour-scenes"><?=(int)$t['scene_count']?> SCENES</span>
    </div>
    <div class="tour-meta"><small>VR TOUR</small><h3><?=htmlspecialchars($t['title'],ENT_QUOTES,'UTF-8')?></h3><p><?=htmlspecialchars($t['description']?:'Интерактивная виртуальная экскурсия',ENT_QUOTES,'UTF-8')?></p><span>ВОЙТИ В ПРОСТРАНСТВО →</span></div>
   </a>
   <?php endforeach;?>
   <?php if(!$gallery['items']):?><div class="empty">Экскурсии появятся здесь после публикации.</div><?php endif;?>
  </div>
 <?php else:?>
  <div class="grid">
   <?php foreach($gallery['items'] as $p):?>
   <a class="card" href="/viewer.php?id=<?=(int)$p['id']?>"><div class="thumb" style="background-image:url('<?=htmlspecialchars(panoramaThumbnailUrl($p['image'],'card'),ENT_QUOTES,'UTF-8')?>')"><i><?=strtoupper(htmlspecialchars($p['projection']??'360',ENT_QUOTES,'UTF-8'))?></i></div><div class="meta"><div><b><?=htmlspecialchars($p['title'],ENT_QUOTES,'UTF-8')?></b><small><?=htmlspecialchars($p['description']?:'Immersive material',ENT_QUOTES,'UTF-8')?></small></div><span><?=strtoupper(htmlspecialchars($p['stereo']??'mono',ENT_QUOTES,'UTF-8'))?> ↗</span></div></a>
   <?php endforeach;?>
   <?php if(!$gallery['items']):?><div class="empty">Материалов пока нет.</div><?php endif;?>
  </div>
 <?php endif;?>

 <?php if($gallery['pages']>1):?>
  <div class="materials-pagination-wrap">
   <p class="materials-pagination-info">Показаны <?=($gallery['offset']+1)?>–<?=min($gallery['total'],$gallery['offset']+$gallery['perPage'])?> из <?=$gallery['total']?> <?=$galleryLabel?></p>
   <nav class="materials-pagination" aria-label="Страницы <?=$galleryType==='tours'?'экскурсий':'VR-материалов'?>">
    <?php if($gallery['page']>1):$url=homeGalleryPageUrl($galleryType,$gallery['page']-1,$tourPage,$materialsPage);?><a class="materials-page-arrow" rel="prev" data-gallery-page href="<?=htmlspecialchars($url,ENT_QUOTES,'UTF-8')?>" aria-label="Предыдущая страница">← Назад</a><?php endif;?>
    <?php $lastVisiblePage=0;foreach($gallery['visible'] as $page):?>
     <?php if($lastVisiblePage&&$page>$lastVisiblePage+1):?><span class="materials-page-gap" aria-hidden="true">…</span><?php endif;?>
     <?php if($page===$gallery['page']):?><span class="materials-page-number active" aria-current="page" aria-label="Страница <?=$page?>"><?=$page?></span>
     <?php else:$url=homeGalleryPageUrl($galleryType,$page,$tourPage,$materialsPage);?><a class="materials-page-number" data-gallery-page href="<?=htmlspecialchars($url,ENT_QUOTES,'UTF-8')?>" aria-label="Страница <?=$page?>"><?=$page?></a><?php endif;?>
     <?php $lastVisiblePage=$page;endforeach;?>
    <?php if($gallery['page']<$gallery['pages']):$url=homeGalleryPageUrl($galleryType,$gallery['page']+1,$tourPage,$materialsPage);?><a class="materials-page-arrow" rel="next" data-gallery-page href="<?=htmlspecialchars($url,ENT_QUOTES,'UTF-8')?>" aria-label="Следующая страница">Далее →</a><?php endif;?>
   </nav>
  </div>
 <?php endif;?>
</div>
