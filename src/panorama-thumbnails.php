<?php
declare(strict_types=1);
/** Generate lightweight preview images beside managed uploads; original remains unchanged. */
function panoramaThumbnailPath(string $imageUrl, string $kind): ?string {
    if (!in_array($kind, ['thumb','card'], true)) return null;
    if (!preg_match('~^/uploads/([a-f0-9]{20})\\.(?:jpg|jpeg|png|webp)$~D', $imageUrl, $m)) return null;
    return UPLOAD_DIR.'/'.$m[1].'-'.$kind.'.webp';
}
function panoramaThumbnailUrl(string $imageUrl, string $kind): string {
    $path=panoramaThumbnailPath($imageUrl,$kind);
    return $path && is_file($path) ? '/uploads/'.basename($path) : $imageUrl;
}
function panoramaCreateThumbnails(string $imageUrl): bool {
    $sourceName=basename($imageUrl);
    if (!preg_match('~^/uploads/[a-f0-9]{20}\\.(?:jpg|jpeg|png|webp)$~D',$imageUrl)) return false;
    $source=UPLOAD_DIR.'/'.$sourceName;
    if (!is_file($source) || is_link($source)) return false;
    $meta=@getimagesize($source);
    if (!$meta || $meta[0]<1 || $meta[1]<1) return false;
    if (!function_exists('imagewebp') || !function_exists('imagecreatetruecolor')) return false;
    // Decode with Imagick if available; GD fallback for common uploads.
    $img=null;
    if (extension_loaded('imagick')) {
        try {
            $im=new Imagick($source);$im->setIteratorIndex(0);
            $im->setImageColorspace(Imagick::COLORSPACE_SRGB);
            $im->setImageFormat('png');
            $blob=$im->getImageBlob();$im->clear();
            $img=@imagecreatefromstring($blob);unset($blob);
        } catch (Throwable $e) { error_log('MiniVR preview Imagick: '.$e->getMessage()); }
    }
    if (!$img) {
        $mime=$meta['mime']??'';
        if ($mime==='image/jpeg' && function_exists('imagecreatefromjpeg')) $img=@imagecreatefromjpeg($source);
        elseif ($mime==='image/png' && function_exists('imagecreatefrompng')) $img=@imagecreatefrompng($source);
        elseif ($mime==='image/webp' && function_exists('imagecreatefromwebp')) $img=@imagecreatefromwebp($source);
    }
    if (!$img) return false;
    $ok=true;
    foreach (['thumb'=>320,'card'=>640] as $kind=>$width) {
        $height=max(1,(int)round($width*$meta[1]/$meta[0]));
        $canvas=imagecreatetruecolor($width,$height);
        imagealphablending($canvas,false);imagesavealpha($canvas,true);
        imagecopyresampled($canvas,$img,0,0,0,0,$width,$height,imagesx($img),imagesy($img));
        $path=panoramaThumbnailPath($imageUrl,$kind);
        if (!$path || !imagewebp($canvas,$path,80)) $ok=false;
        imagedestroy($canvas);
    }
    imagedestroy($img);
    return $ok;
}
function panoramaRemoveThumbnails(string $imageUrl): void {
    foreach (['thumb','card'] as $kind) {
        $path=panoramaThumbnailPath($imageUrl,$kind);
        if ($path && is_file($path) && !is_link($path)) @unlink($path);
    }
}
