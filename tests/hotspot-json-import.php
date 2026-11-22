<?php
declare(strict_types=1);

require_once __DIR__ . '/../src/hotspot-json-import.php';

function expectImportFailure(callable $action, string $fragment): void
{
    try {
        $action();
    } catch (InvalidArgumentException $exception) {
        assert(str_contains($exception->getMessage(), $fragment), $exception->getMessage());
        return;
    }
    throw new RuntimeException('Ожидалась ошибка: ' . $fragment);
}

$sample = ['hotspots' => [
    ['scene_id' => 72, 'label' => 'Фасеточный глаз', 'content' => 'Глаз стрекозы.', 'yaw' => null, 'pitch' => null, 'type' => 'info'],
    ['scene_id' => 73, 'label' => 'Крыло', 'content' => 'Узор прожилок.', 'yaw' => -179.5, 'pitch' => 15.7, 'type' => 'info'],
]];
$toJson = static fn(array $data): string => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR);
$points = parseHotspotPlacementJson($toJson($sample));
assert(count($points) === 2);
assert($points[0]['yaw'] === null && $points[0]['pitch'] === null, 'Coordinates remain unset until placed');
assert($points[1]['yaw'] === -179.5 && $points[1]['pitch'] === 15.7);
assert(hotspotPlacementKey($points[0]) === hotspotPlacementKey([...$points[0], 'yaw' => 88.0]));

expectImportFailure(static fn() => parseHotspotPlacementJson('{'), 'JSON');
expectImportFailure(static fn() => parseHotspotPlacementJson('{}'), 'hotspots');
$duplicate = $sample;
$duplicate['hotspots'][] = $duplicate['hotspots'][0];
expectImportFailure(static fn() => parseHotspotPlacementJson($toJson($duplicate)), 'повтор');
$invalid = $sample;
$invalid['hotspots'][0]['scene_id'] = '72';
expectImportFailure(static fn() => parseHotspotPlacementJson($toJson($invalid)), 'scene_id');
$invalid = $sample;
$invalid['hotspots'][0]['type'] = 'scene';
expectImportFailure(static fn() => parseHotspotPlacementJson($toJson($invalid)), 'type=info');
$invalid = $sample;
$invalid['hotspots'][0]['yaw'] = 0;
expectImportFailure(static fn() => parseHotspotPlacementJson($toJson($invalid)), 'вместе');
$invalid = $sample;
$invalid['hotspots'][0]['yaw'] = 181;
$invalid['hotspots'][0]['pitch'] = 0;
expectImportFailure(static fn() => parseHotspotPlacementJson($toJson($invalid)), 'Yaw');
expectImportFailure(static fn() => validateHotspotPlacementAngles('NaN', 0), 'числовые');
expectImportFailure(static fn() => validateHotspotPlacementAngles(0, '91'), 'Yaw');
assert(validateHotspotPlacementAngles('-180', '90') === [-180.0, 90.0]);

if (extension_loaded('pdo_sqlite')) {
    $db = new PDO('sqlite::memory:', null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('CREATE TABLE hotspots (id INTEGER PRIMARY KEY AUTOINCREMENT, scene_id INTEGER, target_scene_id INTEGER, label TEXT, yaw REAL, pitch REAL, type TEXT, content TEXT)');
    $id = savePlacedHotspot($db, $points[0], 15, 24);
    assert($db->query('SELECT COUNT(*) FROM hotspots')->fetchColumn() == 1);
    assert(savePlacedHotspot($db, $points[0], -180, -23) === $id, 'Reupload updates existing row');
    $stored = $db->query('SELECT yaw,pitch FROM hotspots WHERE id=' . $id)->fetch(PDO::FETCH_ASSOC);
    assert((float)$stored['yaw'] === -180.0 && (float)$stored['pitch'] === -23.0);
    assert($db->query('SELECT COUNT(*) FROM hotspots')->fetchColumn() == 1, 'No duplicate on retry');
    $db->exec("INSERT INTO hotspots(scene_id,label,yaw,pitch,type,content) VALUES(72,'Фасеточный глаз',0,0,'info','Глаз стрекозы.')");
    try {
        savePlacedHotspot($db, $points[0], 35, 45);
        throw new RuntimeException('Expected conflict for ambiguous duplicates');
    } catch (RuntimeException $exception) {
        assert(str_contains($exception->getMessage(), 'дубликаты'));
    }
    assert(!$db->inTransaction(), 'Rollback must close transaction');
}

echo "hotspot-json-import: parsing, validation, no duplicates and transaction passed\n";
