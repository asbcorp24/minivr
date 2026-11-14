<?php
session_start();
require_once __DIR__.'/../../src/db.php';
header('Content-Type: application/json; charset=utf-8');
if(!($_SESSION['admin']??false)){http_response_code(403);echo json_encode(['error'=>'Доступ запрещён']);exit;}
if($_SERVER['REQUEST_METHOD']!=='POST'){http_response_code(405);exit;}
try{
 $id=(int)($_POST['id']??0);
 $enabled=($_POST['enabled']??'')==='1';
 if($id<=0||!in_array($_POST['enabled']??'', ['0','1'],true))throw new RuntimeException('Неверные параметры');
 $db=db();
 $db->beginTransaction();
 $q=$db->prepare('SELECT effects FROM panoramas WHERE id=?');$q->execute([$id]);$p=$q->fetch();
 if(!$p)throw new RuntimeException('Панорама не найдена');
 $effects=json_decode($p['effects']??'{}',true)?:[];
 if($enabled&&empty($effects['parallaxBackground']))throw new RuntimeException('Сначала создайте ИИ-фон');
 $effects['parallaxBackgroundEnabled']=$enabled;
 $q=$db->prepare('UPDATE panoramas SET effects=? WHERE id=?');
 $q->execute([json_encode($effects,JSON_UNESCAPED_UNICODE),$id]);
 $db->commit();
 echo json_encode(['ok'=>true,'enabled'=>$enabled],JSON_UNESCAPED_UNICODE);
}catch(Throwable $e){if(isset($db)&&$db->inTransaction())$db->rollBack();http_response_code(400);echo json_encode(['error'=>$e->getMessage()],JSON_UNESCAPED_UNICODE);}
