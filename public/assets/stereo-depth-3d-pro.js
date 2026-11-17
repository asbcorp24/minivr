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

// Grayscale browser-generated map (0 far, 255 near), one-eye aspect ratio.
export function loadPreparedDepth(image,format,depthImage){
  const width=depthImage.naturalWidth,height=depthImage.naturalHeight;
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(depthImage,0,0);
  const rgba=ctx.getImageData(0,0,width,height).data,depth=new Float32Array(width*height);
  for(let i=0;i<depth.length;i++)depth[i]=rgba[i*4]/255;
  const eyeWidth=format==='sbs'?image.naturalWidth/2:image.naturalWidth;
  const eyeHeight=format==='tb'?image.naturalHeight/2:image.naturalHeight;
  const textureCanvas=document.createElement('canvas');
  textureCanvas.width=Math.min(2048,Math.round(eyeWidth));
  textureCanvas.height=Math.round(textureCanvas.width*eyeHeight/eyeWidth);
  textureCanvas.getContext('2d').drawImage(image,0,0,eyeWidth,eyeHeight,0,0,textureCanvas.width,textureCanvas.height);
  return {width,height,depth,textureCanvas};
}

// Repair unreliable, discontinuous depth before displacing the Three.js mesh.
// Bilateral filtering follows image edges; a bounded slope prevents needle-like
// triangles even when the generated PNG has abrupt jumps in the sky.
export function stabilizeDepth(depth,width,height,textureCanvas){
  const guide=document.createElement('canvas');guide.width=width;guide.height=height;
  const gc=guide.getContext('2d',{willReadFrequently:true});
  gc.drawImage(textureCanvas,0,0,width,height);
  const rgba=gc.getImageData(0,0,width,height).data;
  const luminance=new Float32Array(width*height);
  const saturation=new Float32Array(width*height);
  for(let i=0;i<luminance.length;i++){
    const k=i*4,r=rgba[k]/255,g=rgba[k+1]/255,b=rgba[k+2]/255;
    luminance[i]=.299*r+.587*g+.114*b;
    saturation[i]=Math.max(r,g,b)-Math.min(r,g,b);
  }
  const source=Float32Array.from(depth,v=>Number.isFinite(v)?Math.max(0,Math.min(1,v)):0);
  const filtered=new Float32Array(source.length);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x,center=source[i],lum=luminance[i];
    let sum=0,total=0;
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
      const xx=x+dx,yy=y+dy;if(xx<0||xx>=width||yy<0||yy>=height)continue;
      const j=yy*width+xx;
      const spatial=Math.exp(-(dx*dx+dy*dy)/8);
      const color=Math.exp(-Math.abs(lum-luminance[j])*10);
      const similar=Math.exp(-Math.abs(center-source[j])*4);
      const weight=spatial*color*similar;
      sum+=source[j]*weight;total+=weight;
    }
    filtered[i]=total?sum/total:center;
  }
  // Large, low-texture upper areas (often sky) should have gentle relief.
  // Preserve textured clouds and tree silhouettes by using a soft weight.
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=y*width+x;
    if(y>height*.65)continue;
    const left=luminance[y*width+Math.max(0,x-2)];
    const right=luminance[y*width+Math.min(width-1,x+2)];
    const up=luminance[Math.max(0,y-2)*width+x];
    const down=luminance[Math.min(height-1,y+2)*width+x];
    const texture=Math.abs(left-right)+Math.abs(up-down);
    const skyWeight=Math.max(0,1-y/(height*.65))*Math.max(0,1-texture*5)*Math.max(0,1-saturation[i]*2);
    filtered[i]=filtered[i]*(1-.24*skyWeight);
  }
  // Iterative Lipschitz constraint: neighboring samples cannot form huge
  // near-vertical walls. Changes are symmetric, so the whole scene does not
  // collapse toward the foreground or background.
  const limit=.065;
  for(let pass=0;pass<4;pass++){
    for(let y=0;y<height;y++)for(let x=0;x<width;x++){
      const i=y*width+x;
      if(x>0){const j=i-1,d=filtered[i]-filtered[j];
        if(Math.abs(d)>limit){const correction=(Math.abs(d)-limit)*.5*Math.sign(d);filtered[i]-=correction;filtered[j]+=correction;}
      }
      if(y>0){const j=i-width,d=filtered[i]-filtered[j];
        if(Math.abs(d)>limit){const correction=(Math.abs(d)-limit)*.5*Math.sign(d);filtered[i]-=correction;filtered[j]+=correction;}
      }
    }
  }
  return filtered;
}

export function createStereo3DPro(canvas,image,format,{strength=35,smoothness=75,depthImage=null}={}) {
  const result=depthImage?loadPreparedDepth(image,format,depthImage):estimateStereoDepth(image,format);
  const {width,height,depth,textureCanvas}=result;
  // Stabilize at mesh resolution, not at full AI PNG resolution: avoids a
  // long blocking CPU pass on 768px maps and matches the rendered geometry.
  const stableWidth=Math.min(161,width),stableHeight=Math.min(101,height);
  const meshDepth=new Float32Array(stableWidth*stableHeight);
  for(let y=0;y<stableHeight;y++)for(let x=0;x<stableWidth;x++){
    const sx=Math.min(width-1,Math.round(x*(width-1)/(stableWidth-1)));
    const sy=Math.min(height-1,Math.round(y*(height-1)/(stableHeight-1)));
    meshDepth[y*stableWidth+x]=depth[sy*width+sx];
  }
  const stableDepth=stabilizeDepth(meshDepth,stableWidth,stableHeight,textureCanvas);
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
    const x=Math.max(0,Math.min(stableWidth-1,Math.round(u*(stableWidth-1))));
    const y=Math.max(0,Math.min(stableHeight-1,Math.round((1-v)*(stableHeight-1))));
    const edge=Math.min(1,Math.min(u,1-u,v,1-v)*12);
    vertexDepth[i]=stableDepth[y*stableWidth+x]*edge;
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
