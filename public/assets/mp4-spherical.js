// Inject legacy Google Spherical Video V1 metadata into an MP4 video track.
// Safe for files with moov after mdat; rejects layouts requiring chunk-offset rewrites.
window.miniVrTagMp4=async function(blob){
 const input=new Uint8Array(await blob.arrayBuffer()),view=new DataView(input.buffer);
 const read32=p=>view.getUint32(p),type=p=>String.fromCharCode(...input.subarray(p+4,p+8));
 function boxes(from,to){
  const out=[];let p=from;
  while(p+8<=to){
   let size=read32(p),head=8;
   if(size===1){if(p+16>to)throw Error('MP4: неверный размер блока');const n=view.getBigUint64(p+8);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('MP4 слишком большой');size=Number(n);head=16;}
   else if(size===0)size=to-p;
   if(size<head||p+size>to)throw Error('MP4: повреждённая структура');
   out.push({p,size,head,type:type(p)});p+=size;
  }
  if(p!==to)throw Error('MP4: некорректная граница');
  return out;
 }
 const top=boxes(0,input.length),moov=top.find(x=>x.type==='moov');
 if(!moov)throw Error('MP4: отсутствует moov');
 if(top.some(x=>x.type==='mdat'&&x.p>moov.p))throw Error('MP4: moov находится до медиаданных; требуется пересчёт смещений');
 const moovChildren=boxes(moov.p+moov.head,moov.p+moov.size);
 const tracks=moovChildren.filter(x=>x.type==='trak');
 const video=tracks.find(t=>{
  const mdia=boxes(t.p+t.head,t.p+t.size).find(x=>x.type==='mdia');if(!mdia)return false;
  const hdlr=boxes(mdia.p+mdia.head,mdia.p+mdia.size).find(x=>x.type==='hdlr');
  return hdlr&&String.fromCharCode(...input.subarray(hdlr.p+hdlr.head+8,hdlr.p+hdlr.head+12))==='vide';
 });
 if(!video)throw Error('MP4: видеодорожка не найдена');
 const xml='<?xml version="1.0"?><rdf:SphericalVideo xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:GSpherical="http://ns.google.com/videos/1.0/spherical/"><GSpherical:Spherical>true</GSpherical:Spherical><GSpherical:Stitched>true</GSpherical:Stitched><GSpherical:StitchingSoftware>MiniVR</GSpherical:StitchingSoftware><GSpherical:ProjectionType>equirectangular</GSpherical:ProjectionType></rdf:SphericalVideo>';
 const uuid=new Uint8Array([0xff,0xcc,0x82,0x63,0xf8,0x55,0x4a,0x93,0x88,0x14,0x58,0x7a,0x02,0x52,0x1f,0xdd]);
 const payload=new TextEncoder().encode(xml),delta=8+16+payload.length;
 if(video.size+delta>0xffffffff||moov.size+delta>0xffffffff)throw Error('MP4: размер блока превышает 4 ГБ');
 const output=new Uint8Array(input.length+delta);
 const insertion=video.p+video.size;
 output.set(input.subarray(0,insertion),0);
 const dv=new DataView(output.buffer);
 dv.setUint32(insertion,delta);output.set(new TextEncoder().encode('uuid'),insertion+4);
 output.set(uuid,insertion+8);output.set(payload,insertion+24);
 output.set(input.subarray(insertion),insertion+delta);
 dv.setUint32(video.p,video.size+delta);
 dv.setUint32(moov.p,moov.size+delta);
 // Verify the UUID box resides within the video track.
 const check=new TextDecoder().decode(output.subarray(insertion+24,insertion+delta));
 if(!check.includes('GSpherical:ProjectionType>equirectangular'))throw Error('MP4: ошибка проверки метаданных');
 return new Blob([output],{type:'video/mp4'});
};
