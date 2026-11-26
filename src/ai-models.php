<?php
declare(strict_types=1);

/**
 * Shared MiniVR AI model registry.
 * Add future models here; installers, manifests, storage and admin UI are generic.
 */
function miniVrAiModelRegistry(): array {
    $samRevision = '5850ab45f587c112167512ffef949107115e26a0';
    return [
        'slimsam-77-uniform' => [
            'id' => 'slimsam-77-uniform',
            'name' => 'SlimSAM 77',
            'purpose' => 'Выделение объектов по щелчку в редакторе параллакса',
            'provider' => 'Xenova / Hugging Face',
            'revision' => $samRevision,
            'license' => 'Apache-2.0',
            'format' => 'ONNX',
            'runtime' => 'Transformers.js',
            'tags' => ['segmentation', 'depth-editor'],
            'files' => [
                'config.json' => ['url' => "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$samRevision/config.json", 'min' => 100, 'max' => 100000],
                'preprocessor_config.json' => ['url' => "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$samRevision/preprocessor_config.json", 'min' => 100, 'max' => 100000],
                'quantize_config.json' => ['url' => "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$samRevision/quantize_config.json", 'min' => 100, 'max' => 100000],
                'onnx/vision_encoder_quantized.onnx' => ['url' => "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$samRevision/onnx/vision_encoder_quantized.onnx", 'min' => 1000000, 'max' => 30000000],
                'onnx/prompt_encoder_mask_decoder_quantized.onnx' => ['url' => "https://huggingface.co/Xenova/slimsam-77-uniform/resolve/$samRevision/onnx/prompt_encoder_mask_decoder_quantized.onnx", 'min' => 1000000, 'max' => 20000000],
            ],
        ],
    ];
}

function miniVrAiModelRoot(string $id): string {
    if (!preg_match('/^[a-z0-9][a-z0-9._-]{1,80}$/D', $id)) {
        throw new InvalidArgumentException('Некорректный идентификатор модели');
    }
    return dirname(__DIR__) . '/public/models/' . $id;
}

function miniVrAiModelStatus(array $model): array {
    $root = miniVrAiModelRoot($model['id']);
    $files = [];
    $total = 0;
    $ready = true;
    foreach ($model['files'] as $name => $spec) {
        $path = $root . '/' . $name;
        $size = is_file($path) && !is_link($path) ? (int)filesize($path) : 0;
        $valid = $size >= $spec['min'] && $size <= $spec['max'];
        $files[] = ['name' => $name, 'size' => $size, 'ready' => $valid];
        $total += $size;
        $ready = $ready && $valid;
    }
    return ['ready' => $ready, 'bytes' => $total, 'files' => $files];
}

function miniVrAiDownloadFile(string $url, string $target, int $min, int $max): void {
    $dir = dirname($target);
    if (!is_dir($dir) && !mkdir($dir, 0755, true)) throw new RuntimeException('Не удалось создать каталог модели');
    $tmp = $target . '.part';
    $out = fopen($tmp, 'wb');
    if (!$out) throw new RuntimeException('Не удалось создать временный файл');
    try {
        if (function_exists('curl_init')) {
            $ch = curl_init($url);
            curl_setopt_array($ch, [CURLOPT_FILE => $out, CURLOPT_FOLLOWLOCATION => true, CURLOPT_CONNECTTIMEOUT => 20, CURLOPT_TIMEOUT => 900, CURLOPT_USERAGENT => 'MiniVR AI Model Store/1.0', CURLOPT_FAILONERROR => true]);
            $ok = curl_exec($ch);
            $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
            $err = curl_error($ch);
            curl_close($ch);
            if (!$ok || $code !== 200) throw new RuntimeException('Ошибка загрузки модели: HTTP ' . $code . ' ' . $err);
        } else {
            $ctx = stream_context_create(['http' => ['timeout' => 900, 'follow_location' => 1, 'user_agent' => 'MiniVR AI Model Store/1.0']]);
            $in = @fopen($url, 'rb', false, $ctx);
            if (!$in) throw new RuntimeException('Не удалось скачать файл модели: требуется cURL или allow_url_fopen');
            stream_copy_to_stream($in, $out);
            fclose($in);
        }
    } finally {
        fclose($out);
    }
    $size = @filesize($tmp);
    if ($size === false || $size < $min || $size > $max) {
        @unlink($tmp);
        throw new RuntimeException('Некорректный размер файла модели: ' . (int)$size);
    }
    if (!rename($tmp, $target)) {
        @unlink($tmp);
        throw new RuntimeException('Не удалось сохранить файл модели');
    }
}

function miniVrAiInstallModel(array $model): array {
    $root = miniVrAiModelRoot($model['id']);
    foreach ($model['files'] as $name => $spec) {
        $target = $root . '/' . $name;
        $size = is_file($target) && !is_link($target) ? (int)filesize($target) : 0;
        if ($size < $spec['min'] || $size > $spec['max']) {
            miniVrAiDownloadFile($spec['url'], $target, $spec['min'], $spec['max']);
        }
    }
    $status = miniVrAiModelStatus($model);
    if (!$status['ready']) throw new RuntimeException('Не все файлы модели установлены');
    $manifest = [
        'id' => $model['id'], 'name' => $model['name'], 'revision' => $model['revision'],
        'license' => $model['license'], 'installed_at' => gmdate('c'),
        'status' => $status,
    ];
    if (!is_dir($root) && !mkdir($root, 0755, true)) throw new RuntimeException('Не удалось создать каталог модели');
    $tmp = $root . '/minivr-manifest.json.part';
    file_put_contents($tmp, json_encode($manifest, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
    if (!rename($tmp, $root . '/minivr-manifest.json')) throw new RuntimeException('Не удалось записать manifest модели');
    return $manifest;
}

function miniVrAiDeleteModel(array $model): void {
    $root = miniVrAiModelRoot($model['id']);
    if (!is_dir($root) || is_link($root)) return;
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($it as $file) {
        if ($file->isDir() && !$file->isLink()) rmdir($file->getPathname());
        else unlink($file->getPathname());
    }
    rmdir($root);
}
