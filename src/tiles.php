<?php
declare(strict_types=1);
/** Optional multiresolution generation. Requires PHP Imagick; original image remains fallback. */
function buildPanoramaTiles(string $imageFile,string $outDir): bool {
 if(!extension_loaded('imagick'))return false;
 try{
  $src=new Imagick($imageFile);$w=$src->getImageWidth();$h=$src->getImageHeight();
  if($w<2048||abs($w/$h-2)>0.03){$src->clear();return false;}
  if(!is_dir($outDir)&&!mkdir($outDir,0775,true)&&!is_dir($outDir))throw new RuntimeException('Tiles directory');
  $levels=[];$width=min($w,1024);$level=0;$size=512;
  while(true){
   $height=(int)round($width*$h/$w);
   $im=clone $src;$im->resizeImage($width,$height,Imagick::FILTER_LANCZOS,1);
   $cols=(int)ceil($width/$size);$rows=(int)ceil($height/$size);
   $dir=$outDir.'/'.$level;if(!is_dir($dir))mkdir($dir,0775,true);
   for($y=0;$y<$rows;$y++)for($x=0;$x<$cols;$x++){
    $tile=clone $im;$tile->cropImage(min($size,$width-$x*$size),min($size,$height-$y*$size),$x*$size,$y*$size);
    $tile->setImageFormat('jpeg');$tile->setImageCompressionQuality(85);
    $tile->writeImage($dir.'/'.$x.'_'.$y.'.jpg');$tile->clear();
   }
   $im->clear();$levels[]=['level'=>$level,'width'=>$width,'height'=>$height,'cols'=>$cols,'rows'=>$rows];
   if($width>=$w)break;$width=min($w,$width*2);$level++;
  }
  $src->clear();
  file_put_contents($outDir.'/manifest.json',json_encode(['version'=>1,'projection'=>'360','tileSize'=>$size,'originalWidth'=>$w,'originalHeight'=>$h,'levels'=>$levels],JSON_PRETTY_PRINT|JSON_UNESCAPED_SLASHES));
  return true;
 }catch(Throwable $e){error_log('MiniVR tiles: '.$e->getMessage());return false;}
}
