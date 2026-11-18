<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/tour-builder.php';

$db = new PDO('sqlite::memory:');
$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$db->exec('CREATE TABLE tour_scenes (id INTEGER PRIMARY KEY, tour_id INTEGER, sort_order INTEGER, guided_points TEXT)');
$db->exec("INSERT INTO tour_scenes VALUES (11,1,10,'[1]'),(12,1,20,'[2]'),(13,1,30,'[3]'),(99,2,10,'[9]')");

function assertSceneOrder(PDO $db, int $tourId, array $expected): void
{
    $query = $db->prepare('SELECT id FROM tour_scenes WHERE tour_id=? ORDER BY sort_order,id');
    $query->execute([$tourId]);
    $actual = array_map('intval', $query->fetchAll(PDO::FETCH_COLUMN));
    if ($actual !== $expected) {
        throw new RuntimeException('Expected '.json_encode($expected).', got '.json_encode($actual));
    }
}

saveTourSceneOrder($db, 1, '[13,11,12]');
assertSceneOrder($db, 1, [13,11,12]);
assertSceneOrder($db, 2, [99]);

foreach (['[13,13,12]', '[13,11,99]', '[13,11]', '["13",11,12]', '{"0":13}', 'null', 'invalid'] as $invalid) {
    $rejected = false;
    try {
        saveTourSceneOrder($db, 1, $invalid);
    } catch (RuntimeException $error) {
        $rejected = true;
    }
    if (!$rejected) {
        throw new RuntimeException('Unsafe scene order accepted: '.$invalid);
    }
    assertSceneOrder($db, 1, [13,11,12]);
    assertSceneOrder($db, 2, [99]);
}

$narration = $db->query('SELECT guided_points FROM tour_scenes WHERE id=11')->fetchColumn();
if ($narration !== '[1]') {
    throw new RuntimeException('Reordering modified existing guided narration');
}

echo "Tour builder order checks passed\n";
