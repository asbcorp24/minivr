<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/embed-links.php';

$db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
$db->exec("CREATE TABLE panoramas(id INTEGER PRIMARY KEY,title TEXT,published INTEGER);
CREATE TABLE tours(id INTEGER PRIMARY KEY,title TEXT,published INTEGER,start_scene_id INTEGER);
CREATE TABLE tour_scenes(id INTEGER PRIMARY KEY,tour_id INTEGER,panorama_id INTEGER,sort_order INTEGER);
CREATE TABLE embed_links(id INTEGER PRIMARY KEY AUTOINCREMENT,kind TEXT,target_id INTEGER,token_hash TEXT UNIQUE,label TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,revoked_at TEXT);
INSERT INTO panoramas VALUES(10,'Зал',1),(11,'Скрытый зал',0),(12,'Сад',1);
INSERT INTO tours VALUES(5,'Экскурсия',1,22),(6,'Скрытая экскурсия',0,NULL),(7,'Пустая экскурсия',1,NULL);
INSERT INTO tour_scenes VALUES(21,5,10,1),(22,5,12,2),(23,5,11,3);");

function expectEmbed(bool $condition, string $reason): void
{
    if (!$condition) throw new RuntimeException($reason);
}

$panoramaToken = issueEmbedToken($db, 'panorama', 10, 'Блог');
expectEmbed((bool)preg_match('/^[a-f0-9]{48}$/D', $panoramaToken), 'Token entropy format');
expectEmbed($db->query('SELECT token_hash FROM embed_links LIMIT 1')->fetchColumn() === hash('sha256', $panoramaToken), 'Only the hash should be stored');
$panoramaLink = resolveEmbedToken($db, $panoramaToken);
expectEmbed($panoramaLink !== null, 'Issued panorama token must resolve');
expectEmbed(embedAllowsScene($db, $panoramaLink, 10, 0, 0), 'Panorama token should open its own panorama');
expectEmbed(!embedAllowsScene($db, $panoramaLink, 12, 0, 0), 'Panorama token cannot open another panorama');
expectEmbed(!embedAllowsScene($db, $panoramaLink, 10, 5, 21), 'Panorama token cannot impersonate a tour');
expectEmbed(embedStartingScene($db, $panoramaLink)['panorama_id'] === 10, 'Panorama starting scene');

$tourToken = issueEmbedToken($db, 'tour', 5);
$tourLink = resolveEmbedToken($db, $tourToken);
expectEmbed($tourLink !== null, 'Issued tour token must resolve');
expectEmbed(embedStartingScene($db, $tourLink)['scene_id'] === 22, 'Configured start scene should be preserved');
expectEmbed(embedAllowsScene($db, $tourLink, 10, 5, 21), 'Tour token should open first published scene');
expectEmbed(embedAllowsScene($db, $tourLink, 12, 5, 22), 'Tour token should open another published scene');
expectEmbed(!embedAllowsScene($db, $tourLink, 11, 5, 23), 'Draft panorama cannot be embedded through tour token');
expectEmbed(!embedAllowsScene($db, $tourLink, 12, 6, 22), 'Tour token cannot be reused for a different tour');
expectEmbed(resolveEmbedToken($db, str_repeat('0', 48)) === null, 'Unknown token rejected');
expectEmbed(resolveEmbedToken($db, 'unsafe') === null, 'Invalid token format rejected');

foreach ([['panorama',11],['tour',6],['tour',7],['other',10]] as [$kind,$id]) {
    try { issueEmbedToken($db, $kind, $id);throw new RuntimeException('Unpublished/invalid target accepted'); }
    catch (RuntimeException $error) { if ($error->getMessage() === 'Unpublished/invalid target accepted') throw $error; }
}

$db->prepare('UPDATE embed_links SET revoked_at=CURRENT_TIMESTAMP WHERE token_hash=?')->execute([hash('sha256', $tourToken)]);
expectEmbed(resolveEmbedToken($db, $tourToken) === null, 'Revoked token must stop resolving');
$html = embedIframeCode('https://site.test/embed.php?token=x', 'Зал "<script>');
expectEmbed(str_contains($html, 'allowfullscreen') && str_contains($html, 'xr-spatial-tracking'), 'VR permissions must be present');
expectEmbed(!str_contains($html, '<script>'), 'HTML title must be escaped');

echo "Embed token scopes, revocation and iframe code tests passed\n";
