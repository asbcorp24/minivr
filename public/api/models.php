<?php
declare(strict_types=1);
require_once __DIR__.'/../../src/ai-models.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
$registry=miniVrAiModelRegistry();
$id=(string)($_GET['id']??'');
if($id!==''){
 if(!isset($registry[$id])){http_response_code(404);echo json_encode(['error'=>'model_not_found']);exit;}
 $model=$registry[$id];$status=miniVrAiModelStatus($model);
 if(!$status['ready']){http_response_code(409);echo json_encode(['id'=>$id,'ready'=>false,'error'=>'model_not_installed']);exit;}
 $root=miniVrAiModelRoot($id);$manifestPath=$root.'/minivr-manifest.json';
 $manifest=is_file($manifestPath)?json_decode((string)file_get_contents($manifestPath),true):null;
 echo json_encode(['id'=>$id,'ready'=>true,'name'=>$model['name'],'revision'=>$model['revision'],'license'=>$model['license'],'runtime'=>$model['runtime'],'model_path'=>'/models/'.$id.'/','manifest'=>$manifest],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE);exit;
}
$out=[];
foreach($registry as $key=>$model){$status=miniVrAiModelStatus($model);$out[]=['id'=>$key,'name'=>$model['name'],'purpose'=>$model['purpose'],'format'=>$model['format'],'runtime'=>$model['runtime'],'license'=>$model['license'],'ready'=>$status['ready'],'bytes'=>$status['bytes']];}
echo json_encode(['models'=>$out],JSON_UNESCAPED_SLASHES|JSON_UNESCAPED_UNICODE);
