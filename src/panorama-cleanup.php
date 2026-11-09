<?php
declare(strict_types=1);
require_once __DIR__.'/panorama-thumbnails.php';

/**
 * Managed panorama image cleanup. Never remove arbitrary filesystem paths:
 * only random-name uploads inside UPLOAD_DIR and their matching tile directory.
 */
function panoramaManagedImageName(string $url): ?string {
    if (!preg_match('~^/uploads/([a-f0-9]{20}\\.(?:jpg|jpeg|png|webp))$~D', $url, $m)) return null;
    return $m[1];
}
function panoramaImageReferenced(PDO $db, string $url): bool {
    foreach ([
        'SELECT COUNT(*) FROM panoramas WHERE image = ? OR preview = ?',
        'SELECT COUNT(*) FROM tours WHERE cover = ?',
    ] as $sql) {
        try {
            $stmt = $db->prepare($sql);
            $stmt->execute(str_contains($sql, 'preview') ? [$url, $url] : [$url]);
            if ((int)$stmt->fetchColumn() > 0) return true;
        } catch (Throwable $e) {
            // Fail closed if reference validation cannot complete.
            error_log('MiniVR cleanup reference check: '.$e->getMessage());
            return true;
        }
    }
    return false;
}
function panoramaRemoveTileTree(string $dir): void {
    if (!is_dir($dir) || is_link($dir)) return;
    foreach (new DirectoryIterator($dir) as $entry) {
        if ($entry->isDot()) continue;
        $path = $entry->getPathname();
        if ($entry->isLink()) continue;
        if ($entry->isDir()) panoramaRemoveTileTree($path);
        elseif ($entry->isFile()) @unlink($path);
    }
    @rmdir($dir);
}
function panoramaRemoveUnreferenced(PDO $db, string $url): bool {
    $name = panoramaManagedImageName($url);
    if ($name === null || panoramaImageReferenced($db, $url)) return false;
    $file = UPLOAD_DIR.'/'.$name;
    if (is_link($file)) return false;
    if (is_file($file) && !@unlink($file)) return false;
    panoramaRemoveThumbnails($url);
    $tileName = pathinfo($name, PATHINFO_FILENAME);
    if (preg_match('/^[a-f0-9]{20}$/D', $tileName)) {
        panoramaRemoveTileTree(__DIR__.'/../public/tiles/'.$tileName);
    }
    return true;
}
function panoramaOrphanImages(PDO $db): array {
    $items = [];
    if (!is_dir(UPLOAD_DIR)) return $items;
    foreach (new DirectoryIterator(UPLOAD_DIR) as $entry) {
        if (!$entry->isFile() || $entry->isLink()) continue;
        $name = $entry->getFilename();
        $url = '/uploads/'.$name;
        if (panoramaManagedImageName($url) === null || panoramaImageReferenced($db, $url)) continue;
        $items[] = ['url'=>$url, 'size'=>$entry->getSize()];
    }
    return $items;
}
