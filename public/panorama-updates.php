<?php
require_once __DIR__.'/../src/db.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, max-age=0');
try {
 $db=db();
 $items=$db->query("SELECT id,title,COALESCE(preview,image) AS preview FROM panoramas WHERE published=1 ORDER BY id DESC LIMIT 12")->fetchAll(PDO::FETCH_ASSOC);
 echo json_encode(['panoramas'=>$items],JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
} catch(Throwable $e) {
 http_response_code(500);
 echo json_encode(['error'=>'Unable to load panorama updates']);
}
