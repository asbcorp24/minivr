import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {seamBlurAmount,seamBlurFraction,seamBlendWeight,blendSeamTilePixels,installPanoramaSeamShader}
 from '../public/assets/panorama-seam-blur.js';

assert.equal(seamBlurAmount(undefined),0,'Older panoramas stay unchanged');
assert.equal(seamBlurAmount('bad'),0);
assert.equal(seamBlurAmount(-12),0);
assert.equal(seamBlurAmount(200),100);
assert.equal(seamBlurFraction(0),0);
assert.ok(seamBlurFraction(100)>seamBlurFraction(25));
assert.equal(seamBlendWeight(0,4),1);
assert.equal(seamBlendWeight(4,4),0);

const width=16,height=3;
const left=new Uint8ClampedArray(width*height*4),right=new Uint8ClampedArray(width*height*4);
for(let i=0;i<left.length;i+=4){left[i]=24;left[i+3]=255;right[i]=224;right[i+3]=255;}
const beforeLeft=left.slice(),beforeRight=right.slice();
assert.equal(blendSeamTilePixels(left,width,right,width,height,256,0),0);
assert.deepEqual(left,beforeLeft,'Zero strength must not alter the image');
assert.deepEqual(right,beforeRight);
const radius=blendSeamTilePixels(left,width,right,width,height,256,100);
assert.ok(radius>0&&radius<width/2);
for(let y=0;y<height;y++){
 const a=y*width*4,b=(y*width+width-1)*4;
 assert.equal(left[a],right[b],`0°/360° seam must match at row ${y}`);
 assert.equal(left[a],124,'Both edges converge to the same midpoint');
 assert.equal(left[a+3],255,'Opacity is preserved');
 assert.equal(left[a+radius*4],24,'Pixels outside the left seam band stay sharp');
 assert.equal(right[b-radius*4],224,'Pixels outside the right seam band stay sharp');
}
assert.throws(()=>blendSeamTilePixels(left,17,right,16,height,256,100),/Invalid/);

const one=new Uint8ClampedArray(width*height*4);
for(let y=0;y<height;y++)for(let x=0;x<width;x++)one[(y*width+x)*4]=x===0?12:x===width-1?222:100;
blendSeamTilePixels(one,width,one,width,height,256,100);
assert.equal(one[0],one[(width-1)*4],'Single-tile panorama must wrap too');

const narrow=new Uint8ClampedArray(7*height*4).fill(60);
const wide=new Uint8ClampedArray(16*height*4).fill(190);
assert.ok(blendSeamTilePixels(narrow,7,wide,16,height,256,100)>0);
assert.equal(narrow[0],wide[(16-1)*4],'The last partial tile must join the first tile');

const material={onBeforeCompile:shader=>{
 shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>',
  'vec4 sampledDiffuseColor = texture2D(map,windUv); diffuseColor *= sampledDiffuseColor;');
},customProgramCacheKey:()=> 'wind'};
installPanoramaSeamShader(material,60,{x:0,y:.5},.00025);
const shader={uniforms:{},fragmentShader:'void main() {\n#include <map_fragment>'};
material.onBeforeCompile(shader);
assert.match(shader.fragmentShader,/vec4 minivrSeamSample\(vec2 uv\)/);
assert.match(shader.fragmentShader,/sampledDiffuseColor = minivrSeamSample\(windUv\)/,
 'Seam smoothing composes with existing wind/water sampling');
assert.equal(shader.uniforms.minivrSeamBounds.value.y,.5,'SBS stereo seams are restricted to each eye');
assert.ok(shader.uniforms.minivrSeamWidth.value<.01);
assert.match(material.customProgramCacheKey(),/wind-seam-blur-v1/);
const untouched={};installPanoramaSeamShader(untouched,0,{x:0,y:1});
assert.equal(untouched.onBeforeCompile,undefined,'Disabled smoothing has no material overhead');

const admin=readFileSync(new URL('../public/admin/panorama.php',import.meta.url),'utf8');
assert.match(admin,/name="seamBlurStrength" min="0" max="100"/,'Admin slider supports 0-100%');
assert.match(admin,/\$effects\['seamBlurStrength'\]=max\(0,min\(100,/,'Server clamps the saved strength');

console.log('panorama-seam-blur: 0°/360° pixels, strength bounds, SBS, single tile and shader composition passed');
