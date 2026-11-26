<?php
declare(strict_types=1);
require_once __DIR__ . '/../src/ai-models.php';
$registry = miniVrAiModelRegistry();
if (!isset($registry['slimsam-77-uniform'])) throw new RuntimeException('SlimSAM missing from registry');
foreach ($registry as $id => $model) {
    if (($model['id'] ?? null) !== $id) throw new RuntimeException('Registry key/id mismatch: ' . $id);
    if (empty($model['files']) || !is_array($model['files'])) throw new RuntimeException('Model has no file manifest: ' . $id);
    foreach ($model['files'] as $path => $spec) {
        if (str_starts_with($path, '/') || str_contains($path, '..')) throw new RuntimeException('Unsafe model path: ' . $path);
        if (!filter_var($spec['url'] ?? '', FILTER_VALIDATE_URL)) throw new RuntimeException('Invalid source URL: ' . $id . '/' . $path);
        if (($spec['min'] ?? 0) < 1 || ($spec['max'] ?? 0) < $spec['min']) throw new RuntimeException('Invalid size bounds: ' . $id . '/' . $path);
    }
    if (empty($model['license']) || empty($model['revision']) || empty($model['runtime'])) throw new RuntimeException('Missing model metadata: ' . $id);
}
echo "AI model registry checks passed (" . count($registry) . " model(s))\n";
