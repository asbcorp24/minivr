<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/db.php';
require_once __DIR__ . '/../src/embed-links.php';

header('Cache-Control: private, no-store');
$token = (string)($_GET['token'] ?? '');
$link = resolveEmbedToken(db(), $token);
$start = $link ? embedStartingScene(db(), $link) : null;
if (!$start) {
    http_response_code(404);
    exit('Ссылка встраивания не найдена или отозвана.');
}

$url = '/viewer.php?id='.$start['panorama_id'];
if ($start['tour_id']) {
    $url .= '&tour='.$start['tour_id'].'&scene='.$start['scene_id'];
}
$url .= '&embed='.rawurlencode($token);
header('Location: '.$url, true, 302);
exit;
