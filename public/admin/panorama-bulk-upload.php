<?php
declare(strict_types=1);

session_start();
require_once __DIR__.'/../../src/db.php';
require_once __DIR__.'/../../src/upload.php';
require_once __DIR__.'/../../src/tiles.php';
require_once __DIR__.'/../../src/panorama-thumbnails.php';
require_once __DIR__.'/../../src/panorama-cleanup.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: private, no-store');

function bulkUploadResponse(int $status, array $payload): void
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if (!($_SESSION['admin'] ?? false)) {
    bulkUploadResponse(401, ['ok'=>false, 'error'=>'Сессия администратора завершилась. Войдите снова.']);
}
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    bulkUploadResponse(405, ['ok'=>false, 'error'=>'Доступна только отправка POST.']);
}
// PHP drops the entire multipart body when post_max_size is exceeded.
if (empty($_POST) && empty($_FILES) && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
    bulkUploadResponse(413, ['ok'=>false, 'error'=>'Файл превышает допустимый размер загрузки сервера (post_max_size).']);
}
if (!isset($_SESSION['bulk_panorama_csrf']) ||
    !hash_equals($_SESSION['bulk_panorama_csrf'], (string)($_POST['csrf_token'] ?? ''))) {
    bulkUploadResponse(403, ['ok'=>false, 'error'=>'Сессия устарела. Обновите страницу.']);
}

$uploadedUrl = null;
try {
    $file = $_FILES['image'] ?? null;
    if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        $code = is_array($file) ? (int)($file['error'] ?? UPLOAD_ERR_NO_FILE) : UPLOAD_ERR_NO_FILE;
        if ($code === UPLOAD_ERR_INI_SIZE || $code === UPLOAD_ERR_FORM_SIZE) {
            throw new RuntimeException('Изображение превышает максимальный размер загрузки PHP.');
        }
        throw new RuntimeException('Файл не получен. Проверьте размер и попробуйте снова.');
    }

    $projection = (string)($_POST['projection'] ?? '360');
    $stereo = (string)($_POST['stereo'] ?? 'mono');
    if (!in_array($projection, ['flat', '180', '360'], true) ||
        !in_array($stereo, ['mono', 'sbs', 'tb'], true)) {
        throw new RuntimeException('Некорректный формат панорамы.');
    }

    $title = trim((string)($_POST['title'] ?? ''));
    if ($title === '') {
        $title = trim((string)pathinfo((string)($file['name'] ?? ''), PATHINFO_FILENAME));
    }
    if ($title === '' || strlen($title) > 300) {
        throw new RuntimeException('Название должно содержать от 1 до 300 байт.');
    }
    $description = trim((string)($_POST['description'] ?? ''));
    if (strlen($description) > 4000) {
        throw new RuntimeException('Описание слишком длинное.');
    }

    $name = storeUploadedImage($file, UPLOAD_DIR);
    $uploadedUrl = '/uploads/'.$name;
    $meta = @getimagesize(UPLOAD_DIR.'/'.$name);
    if (!$meta || $meta[0] < 1 || $meta[1] < 1) {
        throw new RuntimeException('Файл не является читаемым изображением.');
    }

    // The same processing as the regular panorama editor: original, previews,
    // and optional 360° mono tiles. Missing GD/Imagick keeps the original usable.
    panoramaCreateThumbnails($uploadedUrl);
    if ($projection === '360' && $stereo === 'mono') {
        buildPanoramaTiles(UPLOAD_DIR.'/'.$name, __DIR__.'/../tiles/'.pathinfo($name, PATHINFO_FILENAME));
    }

    $slugBase = strtolower(trim((string)preg_replace('/[^a-z0-9]+/', '-', $title), '-'));
    $slug = substr($slugBase ?: 'panorama', 0, 90).'-'.bin2hex(random_bytes(6));
    $preview = panoramaThumbnailUrl($uploadedUrl, 'card');
    $db = db();
    $q = $db->prepare('INSERT INTO panoramas(title,slug,description,image,preview,published,projection,stereo,effects) VALUES(?,?,?,?,?,?,?,?,?)');
    $q->execute([
        $title, $slug, $description, $uploadedUrl, $preview,
        isset($_POST['published']) ? 1 : 0, $projection, $stereo,
        '{}', // Default editor settings. Depth effects are configured per panorama later.
    ]);
    $id = (int)$db->lastInsertId();
    bulkUploadResponse(201, ['ok'=>true, 'id'=>$id, 'title'=>$title, 'preview'=>$preview]);
} catch (Throwable $error) {
    // A failed item must not leave untracked uploads or tile directories behind.
    if ($uploadedUrl !== null) {
        try {
            panoramaRemoveUnreferenced(db(), $uploadedUrl);
        } catch (Throwable $cleanupError) {
            error_log('MiniVR bulk upload cleanup: '.$cleanupError->getMessage());
        }
    }
    error_log('MiniVR bulk panorama upload: '.$error->getMessage());
    bulkUploadResponse(422, ['ok'=>false, 'error'=>$error->getMessage()]);
}
