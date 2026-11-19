<?php
declare(strict_types=1);

require_once __DIR__ . '/../config.php';

function db(): PDO
{
    static $db = null;

    if ($db instanceof PDO) {
        return $db;
    }

    $dir = dirname(DB_PATH);
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }

    $db = new PDO(
        'sqlite:' . DB_PATH,
        null,
        null,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        ]
    );

    $db->exec("
        CREATE TABLE IF NOT EXISTS panoramas (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            image TEXT NOT NULL,
            preview TEXT,
            published INTEGER NOT NULL DEFAULT 1,
            projection TEXT NOT NULL DEFAULT '360',
            stereo TEXT NOT NULL DEFAULT 'mono',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tours (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            slug TEXT UNIQUE NOT NULL,
            description TEXT DEFAULT '',
            cover TEXT,
            published INTEGER NOT NULL DEFAULT 1,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS tour_scenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tour_id INTEGER NOT NULL,
            panorama_id INTEGER NOT NULL,
            title TEXT,
            sort_order INTEGER DEFAULT 0,
            FOREIGN KEY(tour_id) REFERENCES tours(id) ON DELETE CASCADE,
            FOREIGN KEY(panorama_id) REFERENCES panoramas(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS hotspots (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            scene_id INTEGER NOT NULL,
            target_scene_id INTEGER,
            label TEXT NOT NULL,
            yaw REAL NOT NULL DEFAULT 0,
            pitch REAL NOT NULL DEFAULT 0,
            type TEXT NOT NULL DEFAULT 'scene',
            content TEXT DEFAULT '',
            FOREIGN KEY(scene_id) REFERENCES tour_scenes(id) ON DELETE CASCADE
        );
    ");

    $cols = $db->query("PRAGMA table_info(panoramas)")->fetchAll();
    $names = array_column($cols, 'name');

    if (!in_array('projection', $names, true)) {
        $db->exec("ALTER TABLE panoramas ADD COLUMN projection TEXT NOT NULL DEFAULT '360'");
    }

    if (!in_array('stereo', $names, true)) {
        $db->exec("ALTER TABLE panoramas ADD COLUMN stereo TEXT NOT NULL DEFAULT 'mono'");
    }

    if (!in_array('effects', $names, true)) {
        $db->exec("ALTER TABLE panoramas ADD COLUMN effects TEXT NOT NULL DEFAULT '{}'");
    }

    $tourCols = $db->query("PRAGMA table_info(tours)")->fetchAll();
    $tourNames = array_column($tourCols, 'name');

    if (!in_array('start_scene_id', $tourNames, true)) {
        $db->exec("ALTER TABLE tours ADD COLUMN start_scene_id INTEGER");
    }

    $hotspotColumns=array_column($db->query("PRAGMA table_info(hotspots)")->fetchAll(),'name');
    if(!in_array('image_stereo',$hotspotColumns,true))$db->exec("ALTER TABLE hotspots ADD COLUMN image_stereo TEXT NOT NULL DEFAULT 'mono'");
    if(!in_array('depth_map',$hotspotColumns,true))$db->exec("ALTER TABLE hotspots ADD COLUMN depth_map TEXT DEFAULT NULL");
    // A narration sequence belongs to a tour scene, not to its shared panorama.
    $sceneColumns=array_column($db->query("PRAGMA table_info(tour_scenes)")->fetchAll(),'name');
    if(!in_array('guided_points',$sceneColumns,true)){
        $db->exec("ALTER TABLE tour_scenes ADD COLUMN guided_points TEXT");
        // Preserve existing authored stops by copying them into independent scene records.
        $rows=$db->query("SELECT ts.id,p.effects FROM tour_scenes ts JOIN panoramas p ON p.id=ts.panorama_id")->fetchAll();
        $update=$db->prepare("UPDATE tour_scenes SET guided_points=? WHERE id=?");
        foreach($rows as $row){
            $effects=json_decode((string)$row['effects'],true);
            $points=is_array($effects['guidedPoints']??null)?$effects['guidedPoints']:[];
            $update->execute([json_encode($points,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES),(int)$row['id']]);
        }
    }
    // Positions belong to tour stops, so shared panorama assets stay reusable.
    if (!in_array('geo_lat', $sceneColumns, true)) {
        $db->exec('ALTER TABLE tour_scenes ADD COLUMN geo_lat REAL DEFAULT NULL');
    }
    if (!in_array('geo_lng', $sceneColumns, true)) {
        $db->exec('ALTER TABLE tour_scenes ADD COLUMN geo_lng REAL DEFAULT NULL');
    }
    $db->exec("UPDATE tour_scenes SET guided_points='[]' WHERE guided_points IS NULL");
    return $db;
}
