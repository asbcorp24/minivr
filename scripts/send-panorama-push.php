<?php
// Run after publishing a panorama: php scripts/send-panorama-push.php <panorama-id>
// Requires composer require minishlink/web-push and MINIVR_VAPID_PUBLIC_KEY,
// MINIVR_VAPID_PRIVATE_KEY, MINIVR_VAPID_SUBJECT in the environment.
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require_once __DIR__.'/../src/db.php';
$autoload=__DIR__.'/../vendor/autoload.php';
if(!is_file($autoload)){fwrite(STDERR,"Install dependency: composer require minishlink/web-push\n");exit(1);}
require $autoload;
$id=(int)($argv[1]??0);
$db=db();
$db->exec("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, subscription_json TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
$q=$db->prepare('SELECT id,title FROM panoramas WHERE id=? AND published=1');$q->execute([$id]);$p=$q->fetch();
if(!$p){fwrite(STDERR,"Published panorama not found\n");exit(1);}
$public=getenv('MINIVR_VAPID_PUBLIC_KEY');$private=getenv('MINIVR_VAPID_PRIVATE_KEY');$subject=getenv('MINIVR_VAPID_SUBJECT');
if(!$public||!$private||!$subject){fwrite(STDERR,"VAPID environment variables missing\n");exit(1);}
$push=new Minishlink\WebPush\WebPush(['VAPID'=>['subject'=>$subject,'publicKey'=>$public,'privateKey'=>$private]]);
$payload=json_encode(['title'=>'Новая панорама MiniVR','body'=>$p['title'],'url'=>'/viewer.php?id='.$p['id']],JSON_UNESCAPED_UNICODE);
foreach($db->query('SELECT subscription_json FROM push_subscriptions') as $row){
 try{$push->queueNotification(Minishlink\WebPush\Subscription::create(json_decode($row['subscription_json'],true)),$payload);}catch(Throwable $e){fwrite(STDERR,$e->getMessage()."\n");}
}
foreach($push->flush() as $report){
 if(!$report->isSuccess()&&$report->isSubscriptionExpired()){
  $delete=$db->prepare('DELETE FROM push_subscriptions WHERE endpoint=?');
  $delete->execute([$report->getEndpoint()]);
 }
 echo $report->getEndpoint().' '.($report->isSuccess()?'OK':'FAILED')."\n";
}
