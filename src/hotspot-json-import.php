<?php
declare(strict_types=1);

/** Parse a list of information hotspots without assigning made-up coordinates. */
function parseHotspotPlacementJson(string $raw): array
{
    if ($raw === '' || strlen($raw) > 2 * 1024 * 1024) {
        throw new InvalidArgumentException('JSON пуст или превышает 2 МБ.');
    }

    try {
        $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $exception) {
        throw new InvalidArgumentException('Ошибка формата JSON: ' . $exception->getMessage(), 0, $exception);
    }
    if (!is_array($data) || !isset($data['hotspots']) || !is_array($data['hotspots']) ||
        !array_is_list($data['hotspots']) || count($data['hotspots']) < 1 || count($data['hotspots']) > 2000) {
        throw new InvalidArgumentException('Ожидается JSON с массивом hotspots (от 1 до 2000 точек).');
    }

    $result = [];
    $seen = [];
    foreach ($data['hotspots'] as $i => $point) {
        $number = $i + 1;
        if (!is_array($point) || !is_int($point['scene_id'] ?? null) || $point['scene_id'] < 1) {
            throw new InvalidArgumentException("Точка №{$number}: нужен положительный целочисленный scene_id.");
        }
        $label = $point['label'] ?? null;
        $content = $point['content'] ?? '';
        if (!is_string($label) || trim($label) === '' || strlen($label) > 600 ||
            !is_string($content) || strlen($content) > 20000) {
            throw new InvalidArgumentException("Точка №{$number}: некорректная подпись или описание.");
        }
        if (($point['type'] ?? 'info') !== 'info') {
            throw new InvalidArgumentException("Точка №{$number}: модуль поддерживает информационные точки (type=info).");
        }
        $yaw = $point['yaw'] ?? null;
        $pitch = $point['pitch'] ?? null;
        if (($yaw === null) !== ($pitch === null)) {
            throw new InvalidArgumentException("Точка №{$number}: yaw и pitch должны быть заполнены вместе.");
        }
        if ($yaw !== null) {
            [$yaw, $pitch] = validateHotspotPlacementAngles($yaw, $pitch);
        }

        $normal = [
            'scene_id' => $point['scene_id'],
            'label' => trim($label),
            'content' => trim($content),
            'type' => 'info',
            'yaw' => $yaw,
            'pitch' => $pitch,
        ];
        $key = hotspotPlacementKey($normal);
        if (isset($seen[$key])) {
            throw new InvalidArgumentException("Точка №{$number}: повтор записи №{$seen[$key]} в том же файле.");
        }
        $seen[$key] = $number;
        $result[] = $normal;
    }
    return $result;
}

/** Exactly the same identity on upload, lookup and save; position is intentionally excluded. */
function hotspotPlacementKey(array $point): string
{
    return hash('sha256', json_encode([
        $point['scene_id'], $point['type'], $point['label'], $point['content'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
}

/** @return array{0:float,1:float} */
function validateHotspotPlacementAngles(mixed $yaw, mixed $pitch): array
{
    if ((!is_int($yaw) && !is_float($yaw) && (!is_string($yaw) || !is_numeric($yaw))) ||
        (!is_int($pitch) && !is_float($pitch) && (!is_string($pitch) || !is_numeric($pitch)))) {
        throw new InvalidArgumentException('Укажите числовые координаты yaw и pitch.');
    }
    $yaw = (float)$yaw;
    $pitch = (float)$pitch;
    if (!is_finite($yaw) || !is_finite($pitch) || $yaw < -180 || $yaw > 180 || $pitch < -90 || $pitch > 90) {
        throw new InvalidArgumentException('Yaw должен быть от −180° до 180°, pitch — от −90° до 90°.');
    }
    return [$yaw, $pitch];
}

/** Update an already imported item instead of inserting a duplicate on retry/reupload. */
function savePlacedHotspot(PDO $db, array $point, float $yaw, float $pitch): int
{
    [$yaw, $pitch] = validateHotspotPlacementAngles($yaw, $pitch);
    $db->beginTransaction();
    try {
        $existing = $db->prepare("SELECT id FROM hotspots WHERE scene_id=? AND type='info' AND label=? AND content=? ORDER BY id");
        $existing->execute([$point['scene_id'], $point['label'], $point['content']]);
        $ids = $existing->fetchAll(PDO::FETCH_COLUMN);
        if (count($ids) > 1) {
            throw new RuntimeException('У этой точки несколько совпадений в базе. Разберите дубликаты вручную.');
        }
        if ($ids) {
            $id = (int)$ids[0];
            $update = $db->prepare('UPDATE hotspots SET yaw=?,pitch=? WHERE id=?');
            $update->execute([$yaw, $pitch, $id]);
        } else {
            $insert = $db->prepare("INSERT INTO hotspots(scene_id,target_scene_id,label,yaw,pitch,type,content) VALUES(?,NULL,?,?,?,'info',?)");
            $insert->execute([$point['scene_id'], $point['label'], $yaw, $pitch, $point['content']]);
            $id = (int)$db->lastInsertId();
        }
        $db->commit();
        return $id;
    } catch (Throwable $exception) {
        $db->rollBack();
        throw $exception;
    }
}
