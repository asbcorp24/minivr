import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {canUseTiledDepth} from '../public/assets/depth-tile-geometry.js';

const viewer=readFileSync(new URL('../public/assets/viewer.js',import.meta.url),'utf8');
const begin=viewer.indexOf('function tiledDepthConfig(');
const end=viewer.indexOf('\nasync function loadInitialPanorama(',begin);
assert.ok(begin>=0&&end>begin);
const context={
 canUseTiledDepth,makeDepthRadiusField:()=>({width:385,height:193,radii:new Float32Array(385*193)}),
 getViewerMode:()=>'desktop',ViewerMode:{DESKTOP:'desktop'},
 parallaxQualityBudget:()=>({layers:5}),
 THREE:{MathUtils:{clamp:(v,a,b)=>Math.max(a,Math.min(b,v))}},
 location:{search:''},URLSearchParams
};
vm.createContext(context);
vm.runInContext(`${viewer.slice(begin,end)}\nthis.tiledDepthConfig=tiledDepthConfig;`,context);
const pixels=new Uint8ClampedArray(256*128*4);
const manualImage={width:512,height:256};
const settings={parallaxEnabled:true,parallaxOcclusionFill:false,parallaxGroups:4,parallaxStrength:85,
 parallaxMicroMotionStrength:72,parallaxMicroMotionSpeed:2.5,parallaxMode:'hybrid'};
const configured=context.tiledDepthConfig(settings,pixels,manualImage);
assert.equal(configured.bands,4);
assert.equal(configured.motion.manualImage,manualImage);
assert.equal(configured.motion.strength,.72);
assert.equal(configured.motion.speed,2.5);
assert.equal(configured.occlusion,.55);
assert.equal(context.tiledDepthConfig({...settings,parallaxMicroMotion:false},pixels).motion,null);
assert.equal(context.tiledDepthConfig({...settings,parallaxOcclusionFill:true},pixels),null);
context.location.search='?micro_motion=0';
assert.equal(context.tiledDepthConfig(settings,pixels).motion,null,'Original query override disables tiled wind too');
context.location.search='?micro_motion_preview=1&micro_motion_mask=1';
const preview=context.tiledDepthConfig(settings,pixels);
assert.equal(preview.motion.strength,1);
assert.equal(preview.motion.previewMask,true);
context.getViewerMode=()=>'cardboard';
context.location.search='';
const cardboard=context.tiledDepthConfig({...settings,parallaxMode:'mesh'},pixels);
assert.equal(cardboard.bands,0,'Cardboard mesh mode has no extra wind layers');
assert.equal(cardboard.motion,null);
assert.match(viewer,/tiledPanorama\?\.setMotionTime\?\.\(time\)/,'Animation loop updates the shared tiled wind uniform');

console.log('tiled-viewer-configuration: default wind, manual mask, preview, Cardboard and fallbacks passed');
