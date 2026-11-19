<?php
declare(strict_types=1);

session_start();
require_once __DIR__.'/../../src/db.php';
require_once __DIR__.'/../../src/embed-links.php';
if (!($_SESSION['admin'] ?? false)) {
    header('Location: /admin/');
    exit;
}
header('Cache-Control: private, no-store');
$db = db();
if (!isset($_SESSION['embed_csrf'])) {
    $_SESSION['embed_csrf'] = bin2hex(random_bytes(32));
}
$error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    try {
        if (!hash_equals($_SESSION['embed_csrf'], (string)($_POST['csrf'] ?? ''))) {
            throw new RuntimeException('Сессия устарела. Обновите страницу.');
        }
        $action = (string)($_POST['action'] ?? '');
        if ($action === 'create') {
            $choice = (string)($_POST['target'] ?? '');
            if (!preg_match('/^(panorama|tour):([1-9][0-9]*)$/D', $choice, $parts)) {
                throw new RuntimeException('Выберите материал для встраивания.');
            }
            $kind = $parts[1];
            $targetId = (int)$parts[2];
            $token = issueEmbedToken($db, $kind, $targetId, (string)($_POST['label'] ?? ''));
            $q = $db->prepare('SELECT title FROM '.($kind === 'panorama' ? 'panoramas' : 'tours').' WHERE id=?');
            $q->execute([$targetId]);
            $_SESSION['embed_new'] = ['token'=>$token, 'title'=>(string)$q->fetchColumn()];
            header('Location: /admin/embeds.php?created=1', true, 303);
            exit;
        }
        if ($action === 'revoke') {
            $id = filter_var($_POST['embed_id'] ?? null, FILTER_VALIDATE_INT, ['options'=>['min_range'=>1]]);
            if (!is_int($id)) {
                throw new RuntimeException('Недопустимая ссылка.');
            }
            $q = $db->prepare('UPDATE embed_links SET revoked_at=CURRENT_TIMESTAMP WHERE id=? AND revoked_at IS NULL');
            $q->execute([$id]);
            header('Location: /admin/embeds.php?revoked=1', true, 303);
            exit;
        }
        throw new RuntimeException('Неизвестное действие.');
    } catch (Throwable $exception) {
        $error = $exception->getMessage();
    }
}

$new = $_SESSION['embed_new'] ?? null;
unset($_SESSION['embed_new']);
$embedUrl = '';
$code = '';
if (is_array($new) && isset($new['token'], $new['title'])) {
    $host = (string)($_SERVER['HTTP_HOST'] ?? 'localhost');
    if (!preg_match('/^[a-z0-9][a-z0-9.\-]*(?::[0-9]{1,5})?$/iD', $host)) {
        $host = 'localhost';
    }
    $forwarded = strtolower((string)($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? ''));
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || $forwarded === 'https';
    $embedUrl = ($https ? 'https' : 'http').'://'.$host.'/embed.php?token='.rawurlencode($new['token']);
    $code = embedIframeCode($embedUrl, $new['title'].' — MiniVR');
}

$panoramas = $db->query('SELECT id,title FROM panoramas WHERE published=1 ORDER BY title,id')->fetchAll();
$tours = $db->query('SELECT t.id,t.title FROM tours t WHERE t.published=1 AND EXISTS(SELECT 1 FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id AND p.published=1 WHERE s.tour_id=t.id) ORDER BY t.title,t.id')->fetchAll();
$links = $db->query("SELECT e.id,e.kind,e.target_id,e.label,e.created_at,e.revoked_at,CASE WHEN e.kind='panorama' THEN (SELECT p.title FROM panoramas p WHERE p.id=e.target_id) ELSE (SELECT t.title FROM tours t WHERE t.id=e.target_id) END target_title FROM embed_links e ORDER BY e.id DESC LIMIT 150")->fetchAll();
$escape = static fn($value): string => htmlspecialchars((string)$value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
?>
<!doctype html><html lang="ru"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Встраивание — MiniVR</title>
<link rel="stylesheet" href="/assets/admin.css?v=<?=filemtime(__DIR__.'/../assets/admin.css')?>">
<link rel="stylesheet" href="/assets/embed-admin.css?v=<?=filemtime(__DIR__.'/../assets/embed-admin.css')?>">
</head><body>
<aside><div class="logo">MINI<span>VR</span></div><a href="/admin/">◉ Панорамы</a><a href="/admin/tours.php">◇ Экскурсии</a><a class="active">⇧ Встраивание</a><a href="/">↗ Сайт</a></aside>
<main class="embed-admin"><header><div><small>EMBED / SHARING</small><h1>Встраивание на другие сайты</h1></div></header>
<p class="embed-intro">Создайте отдельный токен для панорамы или экскурсии. Вставьте полученный HTML-код на другой сайт — посетители увидят интерактивный MiniVR прямо внутри страницы.</p>
<?php if ($error):?><p class="embed-alert" role="alert"><?=$escape($error)?></p><?php endif;?>
<?php if (isset($_GET['revoked'])):?><p class="embed-success" role="status">Ссылка отозвана. Встраивания с этим токеном перестанут открываться.</p><?php endif;?>
<?php if ($code):?>
<section class="editor embed-code" aria-labelledby="embed-ready-title">
 <h2 id="embed-ready-title">✓ Код для вставки готов</h2>
 <p>Скопируйте код сейчас. Для безопасности токен хранится только в виде хеша, поэтому после обновления страницы этот HTML-код нельзя будет восстановить. При необходимости создайте новую ссылку.</p>
 <label for="embed-iframe-code">HTML iframe</label>
 <textarea id="embed-iframe-code" readonly rows="5"><?=$escape($code)?></textarea>
 <div class="embed-code-actions"><button type="button" id="embed-copy">⧉ Скопировать HTML</button><a href="<?=$escape($embedUrl)?>" target="_blank" rel="noopener noreferrer">▶ Проверить ссылку</a><span id="embed-copy-status" role="status" aria-live="polite"></span></div>
</section>
<?php endif;?>
<section class="editor embed-create" aria-labelledby="embed-create-title">
 <h2 id="embed-create-title">Создать код встраивания</h2>
 <form method="post" class="embed-create-form">
  <input type="hidden" name="csrf" value="<?=$escape($_SESSION['embed_csrf'])?>"><input type="hidden" name="action" value="create">
  <label>Панорама или экскурсия
   <select name="target" required>
    <option value="">Выберите материал</option>
    <optgroup label="Панорамы"><?php foreach($panoramas as $p):?><option value="panorama:<?=(int)$p['id']?>"><?=$escape($p['title'])?> #<?=(int)$p['id']?></option><?php endforeach;?></optgroup>
    <optgroup label="Экскурсии"><?php foreach($tours as $t):?><option value="tour:<?=(int)$t['id']?>"><?=$escape($t['title'])?> #<?=(int)$t['id']?></option><?php endforeach;?></optgroup>
   </select>
  </label>
  <label>Для какого сайта? <small>Метка для вашего удобства, необязательно</small><input name="label" maxlength="160" placeholder="Например: блог, сайт школы"></label>
  <button type="submit" <?=!$panoramas&&!$tours?'disabled':''?>>＋ Сгенерировать токен и iframe</button>
 </form>
</section>
<section class="embed-links" aria-labelledby="embed-links-title">
 <h2 id="embed-links-title">Выданные ссылки</h2>
 <?php if (!$links):?><p>Пока нет созданных токенов.</p><?php endif;?>
 <?php foreach($links as $item):?>
 <article class="embed-link-row">
  <div><strong><?=$escape($item['target_title'] ?: 'Удалённый материал')?> <small>· <?=$item['kind']==='tour'?'Экскурсия':'Панорама'?></small></strong>
   <span><?=$escape($item['label'])?></span><small>Создана: <?=$escape($item['created_at'])?></small></div>
  <?php if ($item['revoked_at']):?><span class="embed-revoked">Отозвана</span><?php else:?>
  <form method="post" onsubmit="return confirm('Отозвать ссылку? Старый iframe больше не откроется.')">
   <input type="hidden" name="csrf" value="<?=$escape($_SESSION['embed_csrf'])?>"><input type="hidden" name="action" value="revoke"><input type="hidden" name="embed_id" value="<?=(int)$item['id']?>">
   <button type="submit" class="embed-revoke">Отозвать</button>
  </form>
  <?php endif;?>
 </article>
 <?php endforeach;?>
</section>
<p class="embed-note">Встраивание работает через HTTPS и поддерживает обычное управление панорамой, 3D, GYRO и переходы между сценами. Для полноэкранного режима и датчиков движения принимающий сайт должен разрешить соответствующие возможности iframe.</p>
</main><script src="/assets/embed-admin.js?v=<?=filemtime(__DIR__.'/../assets/embed-admin.js')?>" defer></script></body></html>
