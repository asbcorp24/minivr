<?php
/** Validate the ordered narrative stops owned by one tour scene. */
function parseTourSceneAudio(string $audio): string {
 $audio=trim($audio);
 if($audio!==''&&!preg_match('~^/uploads/guided-audio/[a-f0-9]{32}\.(?:mp3|ogg|wav)$~iD',$audio))throw new RuntimeException('Аудиогид сцены должен быть загруженным MP3, OGG или WAV');
 return $audio;
}
function parseGuidedScenePoints(string $raw): array {
 if(strlen($raw)>100000)throw new RuntimeException('Слишком много данных экскурсии');
 $items=json_decode($raw,true);
 if(!is_array($items)||count($items)>50||array_keys($items)!==range(0,count($items)-1)&&count($items)>0)throw new RuntimeException('Некорректный список точек экскурсии');
 $points=[];
 foreach($items as $step){
  if(!is_array($step))throw new RuntimeException('Некорректный шаг экскурсии');
  $yaw=filter_var($step['yaw']??null,FILTER_VALIDATE_FLOAT);
  $pitch=filter_var($step['pitch']??null,FILTER_VALIDATE_FLOAT);
  $duration=filter_var($step['duration']??null,FILTER_VALIDATE_INT);
  $audio=trim((string)($step['audio']??''));
  if($yaw===false||$pitch===false||$yaw< -180||$yaw>180||$pitch< -90||$pitch>90||$duration===false||$duration<1||$duration>600||strlen($audio)>512||($audio!==''&&!preg_match('~^/uploads/[a-zA-Z0-9_./-]+\.(mp3|ogg|wav)$~iD',$audio)))throw new RuntimeException('Проверьте координаты, время и путь аудио');
  $points[]=['yaw'=>(float)$yaw,'pitch'=>(float)$pitch,'duration'=>(int)$duration,'title'=>substr(trim((string)($step['title']??'')),0,480),'text'=>substr(trim((string)($step['text']??'')),0,8000),'audio'=>$audio];
 }
 return $points;
}
