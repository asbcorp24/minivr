import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the actual browser scene-switch function in strict mode with a tiny
// DOM/renderer stub. This catches undeclared globals that node --check misses.
const viewer=readFileSync(new URL('../public/assets/viewer.js',import.meta.url),'utf8');
const start=viewer.indexOf('async function switchSceneInPlace(');
const end=viewer.indexOf('\nfunction reportSceneSwitchError(',start);
assert(start>=0&&end>start,'Scene switch function must exist');
const code=viewer.slice(start,end);

const disposed=[];
const effect=name=>({dispose(){disposed.push(name)}});
const nextDataset={image:'/uploads/next.jpg',projection:'360',stereo:'mono',effects:'{}',scene:'42',musicTrack:'0',tiles:''};
const title={textContent:'Old panorama'};
const updated=[];
const context={
 fetch:async()=>({ok:true,text:async()=>'<html></html>'}),
 DOMParser:class{parseFromString(){return {
  title:'New panorama — MiniVR',
  querySelector(selector){return {
   '#viewer':{dataset:nextDataset},
   '#tour-data':{textContent:JSON.stringify({current:1,title:'Next',description:'Scene'})},
   '#hotspots-data':{textContent:'[]'},
   '#top b':{textContent:'New panorama'}
  }[selector]}
 }}},
 fetchParallaxDepth:async()=>null,
 fetchManualFoliageMask:async()=>null,
 fetchManualWaterMask:async()=>null,
 THREE:{TextureLoader:class{async loadAsync(){return {name:'next texture'}}}},
 panoramaLoadEpoch:0,
 clearSceneHotspots(){updated.push('hotspots cleared')},
 tiledPanorama:null,
 projection:'360',stereoMode:'mono',effectSettings:{},
 parallaxDepthPixels:null,manualFoliageMaskImage:null,manualWaterMaskImage:null,
 effectSystem:effect('effects'),atmosphereSystem:effect('atmosphere'),
 moonSystem:effect('moon'),environmentSystem:effect('environment'),
 scene:{},
 createPanoramaEffects:()=>effect('new effects'),
 createAtmosphere:()=>effect('new atmosphere'),
 createMoonlight:()=>effect('new moon'),
 createEnvironment:()=>effect('new environment'),
 installPanorama(texture){updated.push(texture.name)},
 tourData:{current:0},sceneNarrationPoints:()=>[],guidedPoints:[],guidedEnabled:false,tour:7,
 guidedSetup(){},resetTourTimer(){},
 window:{dispatchEvent(){}},CustomEvent:class{},
 hotspotData:[],hotspotSprite(){},closePanels(){},menuPage:0,buildMenu(){},
 root:{dataset:{}},document:{title:'',querySelector:()=>title,body:{classList:{remove(){}}}},
 history:{pushState(_state,_title,url){updated.push(url)}},
 syncTourRail(){},syncMobileMotionButton(){},cardboardMenuPlaced:true,
 ViewerMode:{DESKTOP:'desktop',CARDBOARD:'cardboard'},getViewerMode:()=> 'desktop',
 console
};
vm.createContext(context);
vm.runInContext(`'use strict';\n${code}\nthis.switchSceneInPlace=switchSceneInPlace;`,context);
await context.switchSceneInPlace('/viewer.php?id=2&tour=7&scene=42');
assert.deepEqual(disposed,['effects','atmosphere','moon','environment']);
assert.deepEqual(updated,['hotspots cleared','next texture','/viewer.php?id=2&tour=7&scene=42']);
assert.equal(context.tourData.current,1);
assert.equal(context.root.dataset.scene,'42');
assert.equal(title.textContent,'New panorama');

console.log('In-place tour scene transition executes without undeclared state');
