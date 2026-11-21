<?php
// Included only after authentication in public/admin/index.php.
if (!($_SESSION['admin'] ?? false)) return;
if (!isset($_SESSION['bulk_panorama_csrf'])) {
    $_SESSION['bulk_panorama_csrf'] = bin2hex(random_bytes(32));
}
?>
<section class="bulk-upload-panel" aria-labelledby="bulk-upload-title">
 <div class="bulk-upload-heading">
  <div><small>МАТЕРИАЛЫ / ПАКЕТНАЯ ЗАГРУЗКА</small><h2 id="bulk-upload-title">Массовая загрузка панорам</h2></div>
  <span>JPG · PNG · WEBP</span>
 </div>
 <p>Выберите сразу несколько изображений. Для каждого будет создана отдельная панорама с настройками ниже. Название будет таким же, как имя файла, но без расширения.</p>
 <form id="panorama-bulk-form" method="post" enctype="multipart/form-data" action="/admin/panorama-bulk-upload.php">
  <input type="hidden" name="csrf_token" value="<?=htmlspecialchars($_SESSION['bulk_panorama_csrf'], ENT_QUOTES, 'UTF-8')?>">
  <div class="bulk-upload-fields">
   <label class="bulk-upload-files">Фотографии
    <input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required>
    <small data-bulk-files-label>Файлы ещё не выбраны</small>
   </label>
   <label>Проекция по умолчанию
    <select name="projection"><option value="360">360°</option><option value="180">180°</option><option value="flat">Плоская</option></select>
   </label>
   <label>Стерео по умолчанию
    <select name="stereo"><option value="mono">Mono</option><option value="sbs">Stereo SBS</option><option value="tb">Stereo Top / Bottom</option></select>
   </label>
   <label class="bulk-upload-files">Общее описание (необязательно)
    <textarea name="description" rows="2" maxlength="4000" placeholder="Применится ко всем выбранным панорамам"></textarea>
   </label>
  </div>
  <label class="bulk-upload-published"><input type="checkbox" name="published" checked> Опубликовать все после загрузки</label>
  <div class="bulk-upload-actions"><button type="submit">＋ ЗАГРУЗИТЬ ВЫБРАННЫЕ</button><span>Параллакс и эффекты можно настроить отдельно после загрузки.</span></div>
 </form>
 <div class="bulk-upload-results" data-bulk-results hidden aria-live="polite">
  <strong data-bulk-overall-label>Подготовка загрузки...</strong>
  <progress data-bulk-overall-progress max="100" value="0"></progress>
  <ol data-bulk-file-list></ol>
  <p data-bulk-finish></p>
 </div>
</section>
