#!/usr/bin/env python3
"""Generate multiresolution 360 equirectangular tiles for MiniVR.
Usage: python3 scripts/build_tiles.py public/uploads/panorama.jpg public/tiles/panorama-id
Requires: pip install Pillow
"""
import argparse,json,math
from pathlib import Path
from PIL import Image,ImageOps
Image.MAX_IMAGE_PIXELS=600_000_000
def main():
 p=argparse.ArgumentParser();p.add_argument('image');p.add_argument('output');p.add_argument('--tile',type=int,default=512);p.add_argument('--quality',type=int,default=85);a=p.parse_args()
 if a.tile<128 or a.tile>2048: p.error('tile must be 128..2048')
 out=Path(a.output);out.mkdir(parents=True,exist_ok=True)
 with Image.open(a.image) as src:
  im=ImageOps.exif_transpose(src).convert('RGB');w,h=im.size
  if abs(w/h-2)>0.03: p.error('Expected a 2:1 equirectangular 360 panorama')
  levels=[];width=min(w,1024);width=max(2,int(width/2)*2)
  while True:
   height=width//2;scaled=im.resize((width,height),Image.Resampling.LANCZOS)
   level=len(levels);directory=out/str(level);directory.mkdir(exist_ok=True)
   cols=math.ceil(width/a.tile);rows=math.ceil(height/a.tile)
   for y in range(rows):
    for x in range(cols):
     tile=scaled.crop((x*a.tile,y*a.tile,min((x+1)*a.tile,width),min((y+1)*a.tile,height)))
     tile.save(directory/f'{x}_{y}.jpg','JPEG',quality=a.quality,optimize=True)
   levels.append(dict(level=level,width=width,height=height,cols=cols,rows=rows))
   if width>=w:break
   width=min(w,width*2)
  manifest=dict(version=1,projection='360',tileSize=a.tile,originalWidth=w,originalHeight=h,levels=levels)
  (out/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
  print('Created',len(levels),'levels in',out)
if __name__=='__main__':main()
