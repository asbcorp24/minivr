<?php
declare(strict_types=1);

/** Embed tokens are public sharing capabilities, never administrator sessions. */
function embedTargetExists(PDO $db, string $kind, int $targetId): bool
{
    if ($targetId < 1 || !in_array($kind, ['panorama', 'tour'], true)) {
        return false;
    }
    if ($kind === 'panorama') {
        $q = $db->prepare('SELECT 1 FROM panoramas WHERE id=? AND published=1');
    } else {
        $q = $db->prepare('SELECT 1 FROM tours t WHERE t.id=? AND t.published=1 AND EXISTS (SELECT 1 FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id AND p.published=1 WHERE s.tour_id=t.id)');
    }
    $q->execute([$targetId]);
    return (bool) $q->fetchColumn();
}

/** Returns the token once; only its SHA-256 hash is persisted. */
function issueEmbedToken(PDO $db, string $kind, int $targetId, string $label = ''): string
{
    if (!embedTargetExists($db, $kind, $targetId)) {
        throw new RuntimeException('Выберите опубликованную панораму или экскурсию.');
    }
    $label = trim($label);
    if (strlen($label) > 160) {
        throw new RuntimeException('Название ссылки слишком длинное.');
    }
    $token = bin2hex(random_bytes(24));
    $q = $db->prepare('INSERT INTO embed_links(kind,target_id,token_hash,label) VALUES(?,?,?,?)');
    $q->execute([$kind, $targetId, hash('sha256', $token), $label]);
    return $token;
}

/** @return array{kind:string,target_id:int,id:int}|null */
function resolveEmbedToken(PDO $db, string $token): ?array
{
    if (!preg_match('/^[a-f0-9]{48}$/D', $token)) {
        return null;
    }
    $q = $db->prepare('SELECT id,kind,target_id FROM embed_links WHERE token_hash=? AND revoked_at IS NULL');
    $q->execute([hash('sha256', $token)]);
    $link = $q->fetch(PDO::FETCH_ASSOC);
    if (!$link || !embedTargetExists($db, (string) $link['kind'], (int) $link['target_id'])) {
        return null;
    }
    return ['id'=>(int)$link['id'],'kind'=>(string)$link['kind'],'target_id'=>(int)$link['target_id']];
}

/** @return array{panorama_id:int,scene_id:int,tour_id:int}|null */
function embedStartingScene(PDO $db, array $link): ?array
{
    if ($link['kind'] === 'panorama') {
        return ['panorama_id'=>(int)$link['target_id'],'scene_id'=>0,'tour_id'=>0];
    }
    $q = $db->prepare('SELECT start_scene_id FROM tours WHERE id=? AND published=1');
    $q->execute([(int)$link['target_id']]);
    $startSceneId = (int)($q->fetchColumn() ?: 0);
    $q = $db->prepare('SELECT s.id,s.panorama_id FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id AND p.published=1 WHERE s.tour_id=? ORDER BY s.sort_order,s.id');
    $q->execute([(int)$link['target_id']]);
    $scenes = $q->fetchAll(PDO::FETCH_ASSOC);
    if (!$scenes) {
        return null;
    }
    $start = $scenes[0];
    foreach ($scenes as $scene) {
        if ((int)$scene['id'] === $startSceneId) {
            $start = $scene;
            break;
        }
    }
    return ['panorama_id'=>(int)$start['panorama_id'],'scene_id'=>(int)$start['id'],'tour_id'=>(int)$link['target_id']];
}

function embedAllowsScene(PDO $db, array $link, int $panoramaId, int $tourId, int $sceneId): bool
{
    if ($link['kind'] === 'panorama') {
        return $tourId === 0 && $sceneId === 0 && $panoramaId === (int)$link['target_id'];
    }
    if ($tourId !== (int)$link['target_id'] || $sceneId < 1 || $panoramaId < 1) {
        return false;
    }
    $q = $db->prepare('SELECT 1 FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id AND p.published=1 WHERE s.id=? AND s.tour_id=? AND s.panorama_id=?');
    $q->execute([$sceneId, $tourId, $panoramaId]);
    return (bool) $q->fetchColumn();
}

function embedIframeCode(string $embedUrl, string $title): string
{
    $src = htmlspecialchars($embedUrl, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $label = htmlspecialchars($title, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    return '<iframe src="'.$src.'" title="'.$label.'" width="100%" height="560" style="width:100%;max-width:100%;border:0;border-radius:12px" loading="lazy" allow="accelerometer; gyroscope; fullscreen; xr-spatial-tracking" allowfullscreen></iframe>';
}
