import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

// Execute the actual browser scene-switch function in strict mode with a tiny
// DOM/renderer stub. This catches undeclared globals that node --check misses.
const viewer=readFileSync(new URL('../public/assets/viewer.js',import.meta.url),'utf8');
const start=viewer.indexOf('async function switchSceneInPlace(');
const end=viewer.indexOf('\nfunction reportSceneSwitchError(',start);
assert(start>=0&&end>start,'Scene switch function must exist');
const windStart=viewer.indexOf('function tiledFoliageConfig(');
const windEnd=viewer.indexOf('function tiledDepthConfig(',windStart);
assert(windStart>=0&&windEnd>windStart,'Tile wind configuration must exist');
const code=viewer.slice(windStart,windEnd)+'\n'+viewer.slice(start,end);

const disposed=[];
const effect=name=>({dispose(){disposed.push(name)}});
const nextDataset={image:'/uploads/next.jpg',projection:'360',stereo:'mono',effects:'{}',scene:'42',musicTrack:'0',tiles:''};
const title={textContent:'Old panorama'};
const updated=[];
let htmlRequests=0;
const context={
 fetch:async()=>{htmlRequests++;return {ok:true,text:async()=>'<html></html>'}},
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
 canUseTiledDepth:settings=>settings.parallaxEnabled===true&&settings.parallaxOcclusionFill===false,
 tiledDepthConfig:(_settings,pixels)=>pixels?{pixels,bands:3}:null,
 fetchManualFoliageMask:async()=>null,
 fetchManualWaterMask:async()=>null,
 scenePreloader:{getReady:()=>null,cancel(){}},
 loadSceneTexture:async()=>({name:'next texture'}),
 queueNeighborPreload(){},
 THREE:{TextureLoader:class{async loadAsync(){return {name:'next texture'}}}},
 panoramaLoadEpoch:0,
 clearSceneHotspots(){updated.push('hotspots cleared')},
 tiledPanorama:null,
 projection:'360',stereoMode:'mono',effectSettings:{},
 parallaxDepthPixels:null,manualFoliageMaskImage:null,manualWaterMaskImage:null,
 effectSystem:effect('effects'),atmosphereSystem:effect('atmosphere'),
 moonSystem:effect('moon'),environmentSystem:effect('environment'),
 scene:{},renderer:{},location:{search:''},URLSearchParams,
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
 syncTourRail(){},syncMobileTourNav(){},syncTourMap(){},syncMobileMotionButton(){},cardboardMenuPlaced:true,
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
assert.equal(htmlRequests,1);

console.log('In-place tour scene transition executes without undeclared state');

// A tiled panorama implementation may not expose its group (e.g. an older
// cached module). Navigation must still complete without losing viewing mode.
nextDataset.tiles='/tiles/next/manifest.json';
context.createTiledPanorama=async()=>({update(){},dispose(){}});
context.clearPanoramaMeshes=()=>updated.push('panorama meshes cleared');
context.camera={layers:{set(){}}};
context.getViewerMode=()=> 'desktop';
context.installPanorama=()=>{throw Error('Tile scene must not install image fallback')};
await context.switchSceneInPlace('/viewer.php?id=3&tour=7&scene=43');
assert.equal(context.root.dataset.scene,'42'); // The mocked DOM keeps scene 42.
assert.equal(context.root.dataset.tiles,'/tiles/next/manifest.json');
assert.ok(updated.includes('panorama meshes cleared'));
console.log('Tiled tour scene switches even without a group visibility handle');

// A completed neighbor preload is reused instead of fetching another PHP page.
// Its image and masks are passed to the same existing panorama installation path.
const prepared={html:'<html>cached</html>',assets:{image:{cached:true},depth:{depth:true},foliage:{foliage:true},water:{water:true}},manifest:null,baseTiles:null};
context.scenePreloader.getReady=()=>prepared;
nextDataset.tiles='';
const inputs=[];
context.fetchParallaxDepth=async(...args)=>{inputs.push(['depth',args[3]]);return null};
context.fetchManualFoliageMask=async(...args)=>{inputs.push(['foliage',args[1]]);return null};
context.fetchManualWaterMask=async(...args)=>{inputs.push(['water',args[1]]);return null};
context.loadSceneTexture=async(_image,blob)=>{inputs.push(['image',blob]);return {name:'cached texture'}};
context.installPanorama=texture=>updated.push(texture.name);
await context.switchSceneInPlace('/viewer.php?id=4&tour=7&scene=44');
assert.equal(htmlRequests,2,'Cached HTML avoids a third page request');
assert.deepEqual(inputs.map(([kind])=>kind),['depth','foliage','water','image']);
assert.equal(inputs[0][1],prepared.assets.depth);
assert.equal(inputs[3][1],prepared.assets.image);
assert.equal(updated.at(-2),'cached texture');
console.log('Prepared scene HTML and image/mask assets reused on transition');

// When a prepared depth map and tile manifest coexist, the scene switch must
// keep the tiled renderer, rather than silently downloading the source image.
context.scenePreloader.getReady=()=>null;
nextDataset.tiles='/tiles/depth/manifest.json';
nextDataset.effects=JSON.stringify({parallaxEnabled:true,parallaxOcclusionFill:false});
const depthPixels=new Uint8ClampedArray(256*128*4);
context.fetchParallaxDepth=async()=>depthPixels;
let receivedDepth=null,receivedFoliage=null,disposedTileCount=0;
context.createTiledPanorama=async options=>{receivedDepth=options.depth;receivedFoliage=options.foliage;return {update(){},dispose(){disposedTileCount++},group:{visible:true}}};
context.loadSceneTexture=async()=>{throw Error('Depth tiled scene must not load the original image')};
await context.switchSceneInPlace('/viewer.php?id=5&tour=7&scene=45');
assert.equal(receivedDepth.pixels,depthPixels);
assert.equal(receivedDepth.bands,3);
assert.equal(context.tiledPanorama.group.visible,true,'In-place switch makes the new tile group visible');
assert.equal(receivedFoliage.enabled,true,'Missing old wind setting retains the enabled default');

// Next scene gets its own manual mask and disposes the previous tiled scene.
const nextManualMask={width:512,height:256};
context.fetchManualFoliageMask=async()=>nextManualMask;
nextDataset.effects=JSON.stringify({parallaxEnabled:true,parallaxOcclusionFill:false,parallaxMicroMotion:true,parallaxMicroMotionSpeed:2});
await context.switchSceneInPlace('/viewer.php?id=5&tour=7&scene=47');
assert.equal(receivedFoliage.manualMask,nextManualMask);
assert.equal(receivedFoliage.speed,2);
assert.equal(disposedTileCount,1,'Previous tiled scene was disposed exactly once');

// A scene requiring the original occlusion fill must stay on the legacy path.
nextDataset.effects=JSON.stringify({parallaxEnabled:true,parallaxOcclusionFill:true});
receivedDepth=null;
context.loadSceneTexture=async()=>({name:'fallback image'});
context.installPanorama=texture=>updated.push(texture.name);
await context.switchSceneInPlace('/viewer.php?id=6&tour=7&scene=46');
assert.equal(receivedDepth,null,'An unsupported depth effect cannot silently disappear');
assert.equal(updated.at(-2),'fallback image');
console.log('In-place scene switch: depth tiles and legacy effect fallback passed');
