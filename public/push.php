<?php
declare(strict_types=1);
require_once __DIR__.'/../src/db.php';
require_once __DIR__.'/../src/push-config.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
$db=db();
$db->exec("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, subscription_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
if($_SERVER['REQUEST_METHOD']==='GET'){
 $key=minivrPushConfig()['publicKey'];
 echo json_encode(['publicKey'=>$key],JSON_UNESCAPED_SLASHES);exit;
}
if($_SERVER['REQUEST_METHOD']!=='POST'){http_response_code(405);exit;}
$origin=$_SERVER['HTTP_ORIGIN']??'';
$host=$_SERVER['HTTP_HOST']??'';
if($origin&&parse_url($origin,PHP_URL_HOST)!==explode(':',$host)[0]){http_response_code(403);exit;}
$raw=file_get_contents('php://input');
if(strlen($raw)>8192){http_response_code(413);exit;}
$data=json_decode($raw,true);
$endpoint=$data['endpoint']??'';
if(!is_string($endpoint)||strlen($endpoint)>2048||!str_starts_with($endpoint,'https://')||!filter_var($endpoint,FILTER_VALIDATE_URL)){http_response_code(400);echo json_encode(['error'=>'Invalid endpoint']);exit;}
if(!empty($data['unsubscribe'])){
 $q=$db->prepare('DELETE FROM push_subscriptions WHERE endpoint=?');$q->execute([$endpoint]);
}else{
 if(!is_array($data['keys']??null)||!is_string($data['keys']['p256dh']??null)||!is_string($data['keys']['auth']??null)){http_response_code(400);exit;}
 $q=$db->prepare('INSERT OR REPLACE INTO push_subscriptions(endpoint,subscription_json) VALUES(?,?)');$q->execute([$endpoint,json_encode($data,JSON_UNESCAPED_SLASHES)]);
}
echo json_encode(['ok'=>true]);
