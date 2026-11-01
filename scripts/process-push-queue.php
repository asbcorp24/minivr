<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'){http_response_code(403);exit;}
require_once __DIR__.'/../src/db.php';
require_once __DIR__.'/../src/push-config.php';
$autoload=__DIR__.'/../vendor/autoload.php';
if(!is_file($autoload)){fwrite(STDERR,"Missing vendor/autoload.php: run composer require minishlink/web-push\n");exit(1);}
require $autoload;
$config=minivrPushConfig();
if(!$config['publicKey']||!$config['privateKey']||!$config['subject']){fwrite(STDERR,"Configure config/push-secrets.php\n");exit(1);}
$db=db();minivrPushSchema($db);
$lock=fopen(__DIR__.'/../push-queue.lock','c');
if(!$lock||!flock($lock,LOCK_EX|LOCK_NB)){echo "Another worker is running\n";exit;}
$db->exec("INSERT OR IGNORE INTO push_deliveries(event_id,endpoint) SELECT e.id,s.endpoint FROM push_events e CROSS JOIN push_subscriptions s");
$jobs=$db->query("SELECT d.event_id,d.endpoint,s.subscription_json,p.id panorama_id,p.title FROM push_deliveries d JOIN push_events e ON e.id=d.event_id JOIN panoramas p ON p.id=e.panorama_id JOIN push_subscriptions s ON s.endpoint=d.endpoint WHERE d.status='pending' AND d.attempts<5 AND d.next_attempt_at<=".time()." AND p.published=1 ORDER BY d.event_id LIMIT 50")->fetchAll();
$push=new Minishlink\WebPush\WebPush(['VAPID'=>['subject'=>$config['subject'],'publicKey'=>$config['publicKey'],'privateKey'=>$config['privateKey']]]);
foreach($jobs as $job){
 try{
  $payload=json_encode(['title'=>'Новая панорама MiniVR','body'=>$job['title'],'url'=>'/viewer.php?id='.$job['panorama_id']],JSON_UNESCAPED_UNICODE);
  $subscription=Minishlink\WebPush\Subscription::create(json_decode($job['subscription_json'],true,512,JSON_THROW_ON_ERROR));
  $push->queueNotification($subscription,$payload,['TTL'=>86400]);
  foreach($push->flush() as $report){
   $ok=$report->isSuccess();$expired=$report->isSubscriptionExpired();
   $state=$ok?'sent':($expired?'expired':($job['event_id']?'pending':'pending'));
   $q=$db->prepare("UPDATE push_deliveries SET status=?,attempts=attempts+1,next_attempt_at=? WHERE event_id=? AND endpoint=?");
   $q->execute([$state,time()+min(86400,300*2**min(8,(int)$db->query('SELECT 1')->fetchColumn())),$job['event_id'],$job['endpoint']]);
   if($expired){$q=$db->prepare('DELETE FROM push_subscriptions WHERE endpoint=?');$q->execute([$job['endpoint']]);}
   echo $job['panorama_id'].' '.($ok?'sent':'failed')."\n";
  }
 }catch(Throwable $e){$q=$db->prepare("UPDATE push_deliveries SET attempts=attempts+1,next_attempt_at=? WHERE event_id=? AND endpoint=?");$q->execute([time()+900,$job['event_id'],$job['endpoint']]);fwrite(STDERR,$e->getMessage()."\n");}
}
flock($lock,LOCK_UN);fclose($lock);
