<?php
declare(strict_types=1);
session_start();
require_once __DIR__.'/../../src/db.php';
if (!($_SESSION['admin'] ?? false)) { http_response_code(403); exit('Forbidden'); }
if ($_SERVER['REQUEST_METHOD'] !== 'POST') { http_response_code(405); exit('Method not allowed'); }
if (!hash_equals((string)($_SESSION['stereo_depth_csrf'] ?? ''), (string)($_POST['csrf'] ?? ''))) { http_response_code(403); exit('Invalid CSRF token'); }
$scene=(int)($_POST['scene'] ?? 0);
$id=(int)($_POST['hotspot'] ?? 0);
$db=db();
$q=$db->prepare("SELECT * FROM hotspots WHERE id=? AND scene_id=? AND type='image' AND image_stereo IN ('sbs','tb')");
$q->execute([$id,$scene]);
$hotspot=$q->fetch();
if (!$hotspot) { http_response_code(404); exit('Stereo hotspot not found'); }
$url=(string)$hotspot['content'];
$uploadRoot=realpath(UPLOAD_DIR);
$path=realpath(UPLOAD_DIR.'/'.basename($url));
if (!$uploadRoot || !$path || !str_starts_with($url,'/uploads/') || dirname($path)!==$uploadRoot || !is_file($path)) {
    http_response_code(400); exit('AI processing supports only locally uploaded stereo photos');
}
$depthDir=UPLOAD_DIR.'/stereo-depth';
if (!is_dir($depthDir) && !mkdir($depthDir,0775,true) && !is_dir($depthDir)) { http_response_code(500); exit('Cannot create depth directory'); }
$output=$depthDir.'/hotspot-'.$id.'-'.bin2hex(random_bytes(8)).'.png';
$script=realpath(__DIR__.'/../../scripts/generate_stereo_depth.py');
$python=getenv('MINIVR_AI_PYTHON') ?: 'python3';
if (!$script || !function_exists('proc_open')) { http_response_code(503); exit('AI worker unavailable'); }
set_time_limit(600);
$command=[$python,$script,'--input',$path,'--output',$output,'--format',(string)$hotspot['image_stereo']];
$descriptors=[0=>['pipe','r'],1=>['pipe','w'],2=>['pipe','w']];
$process=@proc_open($command,$descriptors,$pipes,dirname($script));
if (!is_resource($process)) { http_response_code(503); exit('Cannot start Python AI worker'); }
fclose($pipes[0]);
stream_set_timeout($pipes[1],580);
stream_set_timeout($pipes[2],580);
$stdout=stream_get_contents($pipes[1]);fclose($pipes[1]);
$stderr=stream_get_contents($pipes[2]);fclose($pipes[2]);
$status=proc_close($process);
if ($status!==0 || !is_file($output) || filesize($output)<100) {
    @unlink($output);
    http_response_code(500);
    exit('Stereo AI failed. Check Python dependencies and model weights. '.htmlspecialchars(substr($stderr ?: $stdout, -1200),ENT_QUOTES,'UTF-8'));
}
$old=(string)($hotspot['depth_map']??'');
$relative='/uploads/stereo-depth/'.basename($output);
$db->prepare('UPDATE hotspots SET depth_map=? WHERE id=? AND scene_id=?')->execute([$relative,$id,$scene]);
if (str_starts_with($old,'/uploads/stereo-depth/')) @unlink($depthDir.'/'.basename($old));
header('Location: /admin/hotspots.php?scene='.$scene.'&depth_success='.$id, true,303);
exit;
