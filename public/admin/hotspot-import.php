<?php
declare(strict_types=1);

session_start();
require_once __DIR__ . '/../../src/db.php';
require_once __DIR__ . '/../../src/hotspot-json-import.php';

if (!($_SESSION['admin'] ?? false)) {
    header('Location: /admin/');
    exit;
}

$db = db();
$_SESSION['hotspot_placement_csrf'] ??= bin2hex(random_bytes(32));
$csrf = $_SESSION['hotspot_placement_csrf'];
$error = '';
$notice = (string)($_SESSION['hotspot_placement_notice'] ?? '');
unset($_SESSION['hotspot_placement_notice']);

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        if (!hash_equals($csrf, (string)($_POST['csrf'] ?? ''))) {
            throw new RuntimeException('Сессия устарела. Обновите страницу и повторите действие.');
        }
        $action = (string)($_POST['action'] ?? '');
        if ($action === 'import') {
            $upload = $_FILES['hotspot_json'] ?? null;
            if (!is_array($upload) || ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK ||
                !is_uploaded_file((string)($upload['tmp_name'] ?? ''))) {
                throw new RuntimeException('Выберите JSON-файл для загрузки.');
            }
            if (($upload['size'] ?? 0) < 1 || $upload['size'] > 2 * 1024 * 1024) {
                throw new RuntimeException('Размер JSON должен быть от 1 байта до 2 МБ.');
            }
            $raw = file_get_contents($upload['tmp_name']);
            if ($raw === false) {
                throw new RuntimeException('Не удалось прочитать JSON.');
            }
            $points = parseHotspotPlacementJson($raw);
            $_SESSION['hotspot_json_placement'] = $points;
            $_SESSION['hotspot_placement_notice'] = 'Загружено ' . count($points) . ' точек. Теперь расставьте их на панорамах.';
            header('Location: /admin/hotspot-import.php');
            exit;
        }
        if ($action === 'reset') {
            unset($_SESSION['hotspot_json_placement']);
            $_SESSION['hotspot_placement_notice'] = 'Список очищен. Размещённые в базе точки сохранены.';
            header('Location: /admin/hotspot-import.php');
            exit;
        }
        if ($action === 'place') {
            $points = $_SESSION['hotspot_json_placement'] ?? [];
            $index = filter_var($_POST['index'] ?? null, FILTER_VALIDATE_INT, ['options' => ['min_range' => 0]]);
            if ($index === false || !isset($points[$index])) {
                throw new RuntimeException('Точка не найдена в загруженном списке.');
            }
            $point = $points[$index];
            $check = $db->prepare('SELECT p.projection FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id WHERE s.id=?');
            $check->execute([$point['scene_id']]);
            $scene = $check->fetch();
            if (!$scene || $scene['projection'] !== '360') {
                throw new RuntimeException('Сцена не найдена или не является панорамой 360°.');
            }
            [$yaw, $pitch] = validateHotspotPlacementAngles($_POST['yaw'] ?? null, $_POST['pitch'] ?? null);
            savePlacedHotspot($db, $point, $yaw, $pitch);
            $_SESSION['hotspot_placement_notice'] = 'Точка «' . $point['label'] . '» сохранена: yaw ' . round($yaw, 1) . '°, pitch ' . round($pitch, 1) . '°.';
            header('Location: /admin/hotspot-import.php?scene=' . $point['scene_id']);
            exit;
        }
        throw new RuntimeException('Неизвестное действие.');
    } catch (Throwable $exception) {
        $error = $exception->getMessage();
    }
}

$points = $_SESSION['hotspot_json_placement'] ?? [];
$scenePoints = [];
foreach ($points as $index => $point) {
    $scenePoints[$point['scene_id']][] = $index;
}

$sceneRows = $db->query('SELECT s.id,s.tour_id,s.title,p.title panorama_title,p.image,p.projection,p.stereo FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id')->fetchAll();
$scenes = [];
foreach ($sceneRows as $row) {
    if (isset($scenePoints[(int)$row['id']])) {
        $scenes[(int)$row['id']] = $row;
    }
}

$existing = [];
foreach (array_chunk(array_keys($scenePoints), 400) as $sceneIds) {
    $query = $db->prepare('SELECT id,scene_id,label,content,type,yaw,pitch FROM hotspots WHERE type=\'info\' AND scene_id IN (' . implode(',', array_fill(0, count($sceneIds), '?')) . ')');
    $query->execute($sceneIds);
    foreach ($query->fetchAll() as $row) {
        $key = hotspotPlacementKey($row);
        $existing[$key][] = $row;
    }
}

$done = 0;
$sceneDone = [];
foreach ($scenePoints as $sceneId => $indexes) {
    $sceneDone[$sceneId] = 0;
    foreach ($indexes as $index) {
        $matches = $existing[hotspotPlacementKey($points[$index])] ?? [];
        if (count($matches) === 1) {
            $sceneDone[$sceneId]++;
            $done++;
        }
    }
}

$requestedScene = filter_var($_GET['scene'] ?? null, FILTER_VALIDATE_INT);
$currentSceneId = $requestedScene !== false && isset($scenePoints[$requestedScene])
    ? $requestedScene : (array_key_first($scenePoints) ?? 0);
$currentScene = $scenes[$currentSceneId] ?? null;
$currentPoints = [];
$initialPoint = 0;
if ($currentSceneId) {
    foreach ($scenePoints[$currentSceneId] as $index) {
        $point = $points[$index];
        $matches = $existing[hotspotPlacementKey($point)] ?? [];
        $saved = count($matches) === 1;
        $conflict = count($matches) > 1;
        $currentPoints[] = [
            'index' => $index,
            'label' => $point['label'],
            'content' => $point['content'],
            'yaw' => $saved ? (float)$matches[0]['yaw'] : $point['yaw'],
            'pitch' => $saved ? (float)$matches[0]['pitch'] : $point['pitch'],
            'saved' => $saved,
            'conflict' => $conflict,
        ];
    }
    foreach ($currentPoints as $i => $point) {
        if (!$point['saved'] && !$point['conflict']) {
            $initialPoint = $i;
            break;
        }
    }
}

$safe = static fn(mixed $value): string => htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
$viewerData = json_encode([
    'scene_id' => $currentSceneId,
    'points' => $currentPoints,
    'initial' => $initialPoint,
], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
?>
<!doctype html>
<html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Привязка точек JSON — MiniVR</title>
<link rel="stylesheet" href="/assets/admin.css">
<link rel="stylesheet" href="/assets/hotspot-json-bind.css?v=<?=filemtime(__DIR__ . '/../assets/hotspot-json-bind.css')?>">
</head><body>
<aside><div class="logo">MINI<span>VR</span></div>
<a href="/admin/">◉ Панорамы</a><a href="/admin/tours.php">◇ Экскурсии</a>
<a class="active" href="/admin/hotspot-import.php">⌖ Привязка точек JSON</a>
<a href="/admin/embeds.php">⇧ Встраивание</a>
</aside>
<main class="hotspot-json-admin">
<header><div><small>SPATIAL HOTSPOT PLACEMENT</small><h1>Привязка точек из JSON</h1>
<p class="hint">Загрузите список, выберите сцену и поставьте каждую точку кликом на панораме 360°. Пока координаты не сохранены, точка не появится в экскурсии.</p></div></header>
<?php if ($error): ?><p role="alert" class="error"><?=$safe($error)?></p><?php endif; ?>
<?php if ($notice): ?><p role="status" class="hotspot-import-notice"><?=$safe($notice)?></p><?php endif; ?>

<section class="hotspot-import-uploads">
 <form method="post" enctype="multipart/form-data" class="hotspot-import-upload-form">
  <input type="hidden" name="csrf" value="<?=$safe($csrf)?>"><input type="hidden" name="action" value="import">
  <label for="hotspot-json-file">JSON с полями <code>hotspots</code>, <code>scene_id</code>, <code>label</code>, <code>content</code></label>
  <input id="hotspot-json-file" type="file" name="hotspot_json" accept=".json,application/json" required>
  <button class="btn">↑ ЗАГРУЗИТЬ JSON</button>
 </form>
 <?php if ($points): ?>
 <div class="hotspot-import-progress"><b><?=$done?> / <?=count($points)?></b><span>размещено · <?=count($scenePoints)?> сцен</span>
  <progress max="<?=count($points)?>" value="<?=$done?>"></progress></div>
 <form method="post" onsubmit="return confirm('Очистить загруженный список? Уже сохранённые точки останутся в базе.')">
  <input type="hidden" name="csrf" value="<?=$safe($csrf)?>"><input type="hidden" name="action" value="reset">
  <button type="submit" class="hotspot-import-reset">Очистить список</button>
 </form>
 <?php endif; ?>
</section>

<?php if ($points): ?>
<div class="hotspot-json-layout">
 <nav class="hotspot-import-scenes" aria-label="Сцены из JSON">
  <label for="hotspot-scene-search">Сцены (<?=count($scenePoints)?>)</label>
  <input id="hotspot-scene-search" type="search" placeholder="Поиск по номеру или названию…">
  <div class="hotspot-import-scene-list">
  <?php foreach ($scenePoints as $sceneId => $indexes):
    $info = $scenes[$sceneId] ?? null;
    $label = $info ? ($info['title'] ?: $info['panorama_title']) : 'Сцена не найдена в базе';
    $isComplete = $sceneDone[$sceneId] === count($indexes);
  ?>
   <a data-import-scene href="?scene=<?=$sceneId?>" class="hotspot-import-scene<?=$currentSceneId === $sceneId ? ' current' : ''?><?=$info ? '' : ' missing'?>"
      aria-current="<?=$currentSceneId === $sceneId ? 'page' : 'false'?>">
    <span class="hotspot-import-scene-title">#<?=$sceneId?> · <?=$safe($label)?></span>
    <small><?=$info ? ($isComplete ? '✓ ' : '') . $sceneDone[$sceneId] . '/' . count($indexes) : '⚠ отсутствует'?></small>
   </a>
  <?php endforeach; ?>
  </div>
 </nav>

 <section class="hotspot-import-workspace">
  <div class="hotspot-import-scene-heading">
   <div><small>СЦЕНА #<?=$currentSceneId?></small><h2><?=$safe($currentScene ? ($currentScene['title'] ?: $currentScene['panorama_title']) : 'Сцена отсутствует')?></h2></div>
   <?php if ($currentScene): ?><a href="/admin/hotspots.php?scene=<?=$currentSceneId?>">Все точки сцены ↗</a><?php endif; ?>
  </div>
  <?php if (!$currentScene): ?>
   <p class="error">Сцена #<?=$currentSceneId?> отсутствует в базе. Проверьте соответствие <code>scene_id</code> в JSON и идентификатора сцены в конструкторе экскурсии.</p>
  <?php elseif ($currentScene['projection'] !== '360'): ?>
   <p class="error">У этой сцены проекция <?=$safe($currentScene['projection'])?>. Модуль привязки работает с панорамами 360°. Измените проекцию или выберите другую сцену.</p>
  <?php else: ?>
   <div class="hotspot-import-viewer" id="hotspot-import-viewer" data-image="<?=$safe($currentScene['image'])?>" data-stereo="<?=$safe($currentScene['stereo'])?>">
    <span class="hotspot-import-viewer-hint">Перетаскивайте для обзора · нажмите на изображение для постановки</span>
    <button type="button" id="hotspot-import-fullscreen" aria-label="На весь экран">⛶ Развернуть</button>
    <div class="hotspot-import-crosshair" aria-hidden="true">+</div>
   </div>
   <div class="hotspot-import-viewer-tools">
    <button type="button" id="hotspot-import-center">⊕ Поставить в центре обзора</button>
    <span id="hotspot-import-viewer-status" role="status">Загрузка панорамы…</span>
   </div>
  <?php endif; ?>
 </section>

 <section class="hotspot-import-points">
  <h2>Точки сцены <small><?=$sceneDone[$currentSceneId]?> / <?=count($currentPoints)?></small></h2>
  <div id="hotspot-import-point-list" class="hotspot-import-point-list" aria-label="Выберите точку">
   <?php foreach ($currentPoints as $i => $point): ?>
    <button type="button" class="hotspot-import-point<?=$i === $initialPoint ? ' selected' : ''?>" data-point="<?=$i?>" aria-pressed="<?=$i === $initialPoint ? 'true' : 'false'?>" <?=!$currentScene || $currentScene['projection'] !== '360' ? 'disabled' : ''?>>
     <span class="hotspot-import-point-name"><?=$safe($point['label'])?></span>
     <small><?=$point['conflict'] ? '⚠ дубликаты в базе' : ($point['saved'] ? '✓ сохранена' : '◯ не размещена')?></small>
    </button>
   <?php endforeach; ?>
  </div>
  <?php if ($currentScene && $currentScene['projection'] === '360'): ?>
   <form id="hotspot-import-place-form" class="hotspot-import-place-form" method="post">
    <input type="hidden" name="csrf" value="<?=$safe($csrf)?>"><input type="hidden" name="action" value="place">
    <input type="hidden" name="index" id="hotspot-import-index">
    <h3 id="hotspot-import-selected-label"></h3>
    <p id="hotspot-import-selected-content"></p>
    <div class="form-columns"><label>Yaw (°)<input id="hotspot-import-yaw" name="yaw" type="number" min="-180" max="180" step="any" required></label>
    <label>Pitch (°)<input id="hotspot-import-pitch" name="pitch" type="number" min="-90" max="90" step="any" required></label></div>
    <p id="hotspot-import-placement-status" role="status">Выберите точку на панораме.</p>
    <button type="submit" class="btn" id="hotspot-import-save" disabled>✓ СОХРАНИТЬ КООРДИНАТЫ</button>
   </form>
  <?php endif; ?>
 </section>
</div>
<script type="application/json" id="hotspot-import-data"><?=$viewerData?></script>
<?php if ($currentScene && $currentScene['projection'] === '360'): ?>
<script type="module" src="/assets/hotspot-json-bind.js?v=<?=filemtime(__DIR__ . '/../assets/hotspot-json-bind.js')?>"></script>
<?php endif; ?>
<?php endif; ?>
<script>
document.querySelector('#hotspot-scene-search')?.addEventListener('input', event => {
 const query = event.target.value.toLocaleLowerCase('ru').trim();
 document.querySelectorAll('[data-import-scene]').forEach(link => { link.hidden = !link.textContent.toLocaleLowerCase('ru').includes(query); });
});
</script>
</main></body></html>
