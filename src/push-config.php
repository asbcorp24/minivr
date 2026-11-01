<?php
declare(strict_types=1);
function minivrPushConfig(): array {
 $file=__DIR__.'/../config/push-secrets.php';
 $settings=is_file($file)?require $file:[];
 return [
  'publicKey'=>(string)($settings['publicKey']??getenv('MINIVR_VAPID_PUBLIC_KEY')?:''),
  'privateKey'=>(string)($settings['privateKey']??getenv('MINIVR_VAPID_PRIVATE_KEY')?:''),
  'subject'=>(string)($settings['subject']??getenv('MINIVR_VAPID_SUBJECT')?:''),
 ];
}
function minivrPushSchema(PDO $db): void {
 $db->exec("CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY,subscription_json TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
 $db->exec("CREATE TABLE IF NOT EXISTS push_events (id INTEGER PRIMARY KEY AUTOINCREMENT,panorama_id INTEGER NOT NULL UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP)");
 $db->exec("CREATE TABLE IF NOT EXISTS push_deliveries (event_id INTEGER NOT NULL,endpoint TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(event_id,endpoint))");
}
function minivrQueuePanorama(PDO $db,int $id): void {
 minivrPushSchema($db);
 $q=$db->prepare('INSERT OR IGNORE INTO push_events(panorama_id) VALUES(?)');
 $q->execute([$id]);
}
