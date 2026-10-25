<?php
declare(strict_types=1);

function storeUploadedImage(array $file, string $directory): string
{
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
        throw new RuntimeException('Ошибка загрузки изображения');
    }

    $mime = (new finfo(FILEINFO_MIME_TYPE))->file($file['tmp_name']);
    $allowed = ['image/jpeg' => 'jpg', 'image/webp' => 'webp', 'image/png' => 'png'];
    if (!isset($allowed[$mime])) {
        throw new RuntimeException('Допустимы JPG, PNG, WebP');
    }

    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        throw new RuntimeException('Не удалось создать каталог загрузки');
    }

    $base = bin2hex(random_bytes(10));

    if ($mime !== 'image/png') {
        $name = $base . '.' . $allowed[$mime];
        if (!move_uploaded_file($file['tmp_name'], $directory . '/' . $name)) {
            throw new RuntimeException('Не удалось сохранить изображение');
        }
        return $name;
    }

    if (!function_exists('imagecreatefrompng')) {
        throw new RuntimeException('На сервере требуется PHP GD для конвертации PNG');
    }

    $source = @imagecreatefrompng($file['tmp_name']);
    if (!$source) {
        throw new RuntimeException('Не удалось прочитать PNG');
    }

    if (function_exists('imagewebp')) {
        imagealphablending($source, false);
        imagesavealpha($source, true);
        $name = $base . '.webp';
        $ok = imagewebp($source, $directory . '/' . $name, 88);
        imagedestroy($source);
        if (!$ok) throw new RuntimeException('Не удалось конвертировать PNG в WebP');
        return $name;
    }

    $w = imagesx($source); $h = imagesy($source);
    $canvas = imagecreatetruecolor($w, $h);
    $bg = imagecolorallocate($canvas, 8, 14, 18);
    imagefill($canvas, 0, 0, $bg);
    imagealphablending($canvas, true);
    imagecopy($canvas, $source, 0, 0, 0, 0, $w, $h);
    $name = $base . '.jpg';
    $ok = imagejpeg($canvas, $directory . '/' . $name, 90);
    imagedestroy($source); imagedestroy($canvas);
    if (!$ok) throw new RuntimeException('Не удалось конвертировать PNG в JPEG');
    return $name;
}
