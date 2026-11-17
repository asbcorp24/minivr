import * as THREE from '/assets/vendor/three/three.module.js';

// Local, low-resolution stereo block matching. No network/AI dependency.
export function estimateStereoDepth(image, format, width=192) {
  const eyeWidth=format==='sbs'?image.naturalWidth/2:image.naturalWidth;
  const eyeHeight=format==='tb'?image.naturalHeight/2:image.naturalHeight;
  const height=Math.max(32,Math.min(120,Math.round(width*eyeHeight/eyeWidth)));
  const sample=(eye)=>{
    const c=document.createElement('canvas');c.width=width;c.height=height;
    const ctx=c.getContext('2d',{willReadFrequently:true});
    const sx=format==='sbs'?eye*eyeWidth:0,sy=format==='tb'?eye*eyeHeight:0;
    ctx.drawImage(image,sx,sy,eyeWidth,eyeHeight,0,0,width,height);
    const pixels=ctx.getImageData(0,0,width,height).data;
    const gray=new Float32Array(width*height);
    for(let i=0;i<gray.length;i++)gray[i]=(pixels[i*4]*.299+pixels[i*4+1]*.587+pixels[i*4+2]*.114)/255;
    return {canvas:c,gray};
  };
  const left=sample(0),right=sample(1);
  const raw=new Float32Array(width*height),valid=new Uint8Array(width*height);
  const radius=2,maxShift=Math.min(18,Math.floor(width*.085)),stride=2;
  for(let y=radius+2;y<height-radius-2;y+=stride){
    for(let x=radius+maxShift+2;x<width-radius-maxShift-2;x+=stride){
      let best=Infinity,second=Infinity,shift=0;
      for(let d=-maxShift;d<=maxShift;d++){
        let error=0;
        for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
          const a=left.gray[(y+dy)*width+x+dx],b=right.gray[(y+dy)*width+x+dx-d];
          error+=Math.abs(a-b);
        }
        if(error<best){second=best;best=error;shift=d}
        else if(error<second)second=error;
      }
      const idx=y*width+x;
      if(best<11&&second-best>.012){raw[idx]=shift;valid[idx]=1}
    }
  }
  // Fill holes conservatively; average reliable neighbors to suppress false edges.
  const depth=new Float32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let total=0,weight=0;
    for(let dy=-5;dy<=5;dy+=2)for(let dx=-5;dx<=5;dx+=2){
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
      const idx=yy*width+xx;if(!valid[idx])continue;
      const w=1/(1+dx*dx+dy*dy);total+=raw[idx]*w;weight+=w;
    }
    depth[y*width+x]=weight?total/weight:0;
  }
  const values=Array.from(depth).filter(Number.isFinite).sort((a,b)=>a-b);
  const lo=values[Math.floor(values.length*.1)]||0,hi=values[Math.floor(values.length*.9)]||1;
  const range=Math.max(2,hi-lo);
  for(let i=0;i<depth.length;i++)depth[i]=Math.max(0,Math.min(1,(depth[i]-lo)/range));
  const textureCanvas=document.createElement('canvas');textureCanvas.width=Math.min(2048,Math.round(eyeWidth));textureCanvas.height=Math.round(textureCanvas.width*eyeHeight/eyeWidth);textureCanvas.getContext('2d').drawImage(image,0,0,eyeWidth,eyeHeight,0,0,textureCanvas.width,textureCanvas.height);if(format==='tb')textureCanvas.getContext('2d').drawImage(image,0,eyeHeight,eyeWidth,eyeHeight,0,0,textureCanvas.width,textureCanvas.height);
  return {width,height,depth,textureCanvas};
}

export function createStereo3DPro(canvas,image,format,{strength=35,smoothness=75}={}) {
  const result=estimateStereoDepth(image,format);
  const {width,height,depth,textureCanvas}=result;
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
  renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
  const scene=new THREE.Scene();scene.background=new THREE.Color(0x020b11);
  const camera=new THREE.PerspectiveCamera(38,1,.1,100);
  camera.position.set(0,0,6.5);
  const aspect=width/height,planeHeight=3.8,planeWidth=planeHeight*aspect;
  const cols=Math.min(160,width-1),rows=Math.min(100,height-1);
  const geometry=new THREE.PlaneGeometry(planeWidth,planeHeight,cols,rows);
  const positions=geometry.attributes.position,uv=geometry.attributes.uv;
  const vertexDepth=new Float32Array(positions.count);
  for(let i=0;i<positions.count;i++){
    const u=uv.getX(i),v=uv.getY(i);
    const x=Math.max(0,Math.min(width-1,Math.round(u*(width-1))));
    const y=Math.max(0,Math.min(height-1,Math.round((1-v)*(height-1))));
    const edge=Math.min(1,Math.min(u,1-u,v,1-v)*12);
    vertexDepth[i]=depth[y*width+x]*edge;
    positions.setZ(i,vertexDepth[i]*1.45*(strength/100));
  }
  geometry.computeVertexNormals();
  const texture=new THREE.CanvasTexture(textureCanvas);texture.colorSpace=THREE.SRGBColorSpace;
  texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  const material=new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide});
  const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
  let targetX=0,targetY=0,actualX=0,actualY=0,raf=0,disposed=false;
  const setStrength=value=>{
    strength=Math.max(0,Math.min(100,Number(value)||0));
    for(let i=0;i<positions.count;i++)positions.setZ(i,vertexDepth[i]*1.45*(strength/100));
    positions.needsUpdate=true;geometry.computeVertexNormals();
  };
  const resize=()=>{
    if(disposed)return;
    const w=Math.max(1,window.innerWidth-32),h=Math.max(1,window.innerHeight-160);
    const ratio=planeWidth/planeHeight;
    const displayWidth=Math.min(w,h*ratio),displayHeight=displayWidth/ratio;
    renderer.setSize(displayWidth,displayHeight,false);
    canvas.style.width=displayWidth+'px';canvas.style.height=displayHeight+'px';
    camera.aspect=displayWidth/displayHeight;camera.updateProjectionMatrix();
    // Fit full image with some overscan to avoid exposing mesh edges on tilt.
    const vertical=2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    const distance=Math.max(planeHeight/vertical,planeWidth/(vertical*camera.aspect))*1.12;
    camera.position.z=distance;
  };
  const move=e=>{
    const bounds=canvas.getBoundingClientRect();
    targetX=Math.max(-1,Math.min(1,((e.clientX-bounds.left)/bounds.width-.5)*2));
    targetY=Math.max(-1,Math.min(1,((e.clientY-bounds.top)/bounds.height-.5)*2));
  };
  const reset=()=>{targetX=0;targetY=0};
  const render=()=>{
    if(disposed)return;
    const damping=.025+(100-smoothness)*.002;
    actualX+=(targetX-actualX)*damping;actualY+=(targetY-actualY)*damping;
    const travel=1.05*(strength/100);
    camera.position.x=actualX*travel;camera.position.y=-actualY*travel*.65;
    camera.lookAt(0,0,0);
    renderer.render(scene,camera);raf=requestAnimationFrame(render);
  };
  canvas.addEventListener('pointermove',move);canvas.addEventListener('pointerleave',reset);
  window.addEventListener('resize',resize);resize();render();
  return {setStrength,dispose(){
    disposed=true;cancelAnimationFrame(raf);
    canvas.removeEventListener('pointermove',move);canvas.removeEventListener('pointerleave',reset);
    window.removeEventListener('resize',resize);
    geometry.dispose();material.dispose();texture.dispose();renderer.dispose();
  }};
}
