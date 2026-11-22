<?php
declare(strict_types=1);
require_once __DIR__.'/../../src/db.php';
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=30');
header('X-Content-Type-Options: nosniff');
$db=db();
$action=(string)($_GET['action']??'catalog');
$id=filter_var($_GET['id']??null,FILTER_VALIDATE_INT,['options'=>['min_range'=>1]]);
function output(array $data):never { echo json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_INVALID_UTF8_SUBSTITUTE);exit; }
function publicUrl(?string $path):?string {
 if(!$path)return null;
 if(str_starts_with($path,'/'))return $path;
 if(preg_match('~^https://~i',$path))return $path;
 return '/'.ltrim($path,'/');
}
if($action==='catalog'){
 $panoramas=$db->query('SELECT id,title,description,image,preview,projection,stereo FROM panoramas WHERE published=1 ORDER BY id DESC')->fetchAll(PDO::FETCH_ASSOC);
 $tours=$db->query('SELECT id,title,description,cover FROM tours WHERE published=1 ORDER BY id DESC')->fetchAll(PDO::FETCH_ASSOC);
 foreach($panoramas as &$p){$p['image']=publicUrl($p['image']);$p['preview']=publicUrl($p['preview']);}unset($p);
 foreach($tours as &$t)$t['cover']=publicUrl($t['cover']);unset($t);
 output(['version'=>1,'panoramas'=>$panoramas,'tours'=>$tours]);
}
if($action==='panorama'&&$id){
 $q=$db->prepare('SELECT id,title,description,image,preview,projection,stereo,effects FROM panoramas WHERE id=? AND published=1');
 $q->execute([$id]);$p=$q->fetch(PDO::FETCH_ASSOC);
 if(!$p){http_response_code(404);output(['error'=>'not_found']);}
 $p['image']=publicUrl($p['image']);$p['preview']=publicUrl($p['preview']);
 $p['effects']=json_decode($p['effects']??'{}',true)?:[];
 output(['version'=>1,'panorama'=>$p]);
}
if($action==='tour'&&$id){
 $q=$db->prepare('SELECT id,title,description,cover,start_scene_id FROM tours WHERE id=? AND published=1');$q->execute([$id]);$tour=$q->fetch(PDO::FETCH_ASSOC);
 if(!$tour){http_response_code(404);output(['error'=>'not_found']);}
 $tour['cover']=publicUrl($tour['cover']);
 $q=$db->prepare('SELECT s.id,s.panorama_id,COALESCE(NULLIF(s.title,\'\'),p.title) title,p.description,s.duration_seconds,s.guided_points,s.scene_audio,s.geo_lat,s.geo_lng,p.image,p.preview,p.projection,p.stereo,p.effects FROM tour_scenes s JOIN panoramas p ON p.id=s.panorama_id WHERE s.tour_id=? AND p.published=1 ORDER BY s.sort_order,s.id');
 $q->execute([$id]);$scenes=$q->fetchAll(PDO::FETCH_ASSOC);
 $visibleIds=[];
 foreach($scenes as &$s){
  $visibleIds[(int)$s['id']]=true;
  $s['image']=publicUrl($s['image']);$s['preview']=publicUrl($s['preview']);
  $s['scene_audio']=publicUrl($s['scene_audio']);
  $s['guided_points']=json_decode($s['guided_points']??'[]',true)?:[];
  $s['effects']=json_decode($s['effects']??'{}',true)?:[];
 }unset($s);
 $q=$db->prepare('SELECT h.*,target.panorama_id target_panorama_id FROM hotspots h JOIN tour_scenes s ON s.id=h.scene_id JOIN panoramas p ON p.id=s.panorama_id LEFT JOIN tour_scenes target ON target.id=h.target_scene_id WHERE s.tour_id=? AND p.published=1 ORDER BY h.id');
 $q->execute([$id]);
 $hotspots=[];
 foreach($q->fetchAll(PDO::FETCH_ASSOC) as $h){
  if(!isset($visibleIds[(int)$h['scene_id']]))continue;
  if($h['type']==='scene'&&!isset($visibleIds[(int)($h['target_scene_id']??0)]))continue;
  if($h['type']==='image'){$h['content']=publicUrl($h['content']);$h['depth_map']=publicUrl($h['depth_map']??null);}
  $hotspots[]=$h;
 }
 output(['version'=>1,'tour'=>$tour,'scenes'=>$scenes,'hotspots'=>$hotspots]);
}
http_response_code(400);output(['error'=>'bad_request']);
