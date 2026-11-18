<?php
declare(strict_types=1);

/** Save a complete scene order without replacing scene IDs or their hotspots/narration. */
function saveTourSceneOrder(PDO $db, int $tourId, string $rawOrder): void
{
    if ($tourId <= 0 || strlen($rawOrder) > 12000) {
        throw new RuntimeException('Некорректный маршрут экскурсии');
    }

    $order = json_decode($rawOrder, true);
    if (!is_array($order) || count($order) > 500 ||
        (count($order) && array_keys($order) !== range(0, count($order) - 1))) {
        throw new RuntimeException('Некорректный список сцен');
    }
    foreach ($order as $id) {
        if (!is_int($id) || $id <= 0) {
            throw new RuntimeException('Некорректный идентификатор сцены');
        }
    }
    if (count($order) !== count(array_unique($order))) {
        throw new RuntimeException('Сцены маршрута не должны повторяться');
    }

    $db->beginTransaction();
    try {
        $query = $db->prepare('SELECT id FROM tour_scenes WHERE tour_id=?');
        $query->execute([$tourId]);
        $actual = array_map('intval', $query->fetchAll(PDO::FETCH_COLUMN));
        $expected = $order;
        sort($actual, SORT_NUMERIC);
        sort($expected, SORT_NUMERIC);
        if ($actual !== $expected) {
            throw new RuntimeException('Состав экскурсии изменился. Обновите страницу и повторите попытку.');
        }
        $update = $db->prepare('UPDATE tour_scenes SET sort_order=? WHERE id=? AND tour_id=?');
        foreach ($order as $index => $sceneId) {
            $update->execute([($index + 1) * 10, $sceneId, $tourId]);
        }
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}
