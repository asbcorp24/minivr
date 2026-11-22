import assert from 'node:assert/strict';
import {sampleDepthPixels,makeDepthRadiusField,sampleDepthRadius,canUseTiledDepth} from '../public/assets/depth-tile-geometry.js';

// Deliberately asymmetric depths across longitude: a seam-safe interpolator
// must give identical results at both horizontal edges of the panorama.
const pixels=new Uint8ClampedArray(256*128*4);
for(let y=0;y<128;y++)for(let x=0;x<256;x++){
 const i=(y*256+x)*4;
 pixels[i]=Math.round(255*(.45+.4*Math.sin(2*Math.PI*x/256)+.1*Math.cos(y/20)));
 pixels[i+3]=255;
}
assert.equal(sampleDepthPixels(pixels,0,.4),sampleDepthPixels(pixels,1,.4));
assert.equal(sampleDepthPixels(pixels,0,.4),sampleDepthPixels(pixels,-1,.4));
for(const relief of [false,true]){
 const field=makeDepthRadiusField(pixels,{parallaxStrength:85,parallaxNonlinear:true,parallaxNonlinearStrength:65},relief);
 assert.equal(field.width,relief?385:257);
 assert.equal(field.height,relief?193:129);
 assert.notEqual(sampleDepthRadius(field,.2,.5),sampleDepthRadius(field,.7,.5),'Depth moves different surface regions to different radii');
 for(const v of [0,.04,.2,.5,.73,1]){
  assert.equal(sampleDepthRadius(field,0,v),sampleDepthRadius(field,1,v),'360° seam must meet');
  assert.ok(Math.abs(sampleDepthRadius(field,-.001,v)-sampleDepthRadius(field,.999,v))<1e-9,'Wrapped texture coordinates remain continuous');
  for(const u of [.125,.25,.333,.5,.875]){
   // Two tiles calculated separately share the exact same boundary sample.
   assert.equal(sampleDepthRadius(field,u,v),sampleDepthRadius(field,u,v));
  }
 }
 assert.ok(Math.abs(sampleDepthRadius(field,.1,0)-sampleDepthRadius(field,.9,0))<1e-5,'Pole fade avoids deformed poles');
}
const noEffect=makeDepthRadiusField(pixels,{parallaxStrength:0},true);
assert.equal(sampleDepthRadius(noEffect,.2,.5),500,'Zero strength matches the original 500-unit sphere');
assert.throws(()=>makeDepthRadiusField(new Uint8Array(4),{parallaxStrength:80}),/Invalid/);

const compatible={parallaxEnabled:true,parallaxMicroMotion:false,parallaxWaterMotion:false,parallaxContactShadows:false,parallaxOcclusionFill:false};
assert.equal(canUseTiledDepth(compatible),true);
for(const setting of ['parallaxWaterMotion','parallaxContactShadows','parallaxOcclusionFill']){
 assert.equal(canUseTiledDepth({...compatible,[setting]:true}),false,`${setting} uses legacy full-image renderer`);
}
assert.equal(canUseTiledDepth({...compatible,parallaxMicroMotion:true}),true,'Foliage wind works on depth tiles');
assert.equal(canUseTiledDepth({...compatible,parallaxMicroMotion:undefined}),true,'Legacy undefined micro-motion still enables animation on tiles');
assert.equal(canUseTiledDepth({...compatible,parallaxEnabled:false}),false);
console.log('depth-tile-geometry: inverse-depth shell, seam, poles, fallback and zero-strength passed');
