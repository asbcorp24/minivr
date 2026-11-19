import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../public/assets/tour-geo-picker.js',import.meta.url),'utf8');
function element(initial={}){
 const listeners={};
 return {
  hidden:false,disabled:false,value:'',textContent:'',...initial,
  addEventListener(type,callback){(listeners[type]??=[]).push(callback)},
  trigger(type,event={}){for(const callback of listeners[type]||[])callback(event)},
  focus(){},getClientRects(){return [1]}
 };
}
function scene(lat='',lng=''){
 const fields={
  '[name="geo_lat"]':element({value:lat}),
  '[name="geo_lng"]':element({value:lng}),
  '[data-tour-geo-status]':element(),
  '[data-tour-geo-view]':element(),
  '[data-tour-geo-clear]':element(),
  '[data-tour-geo-open]':element()
 };
 return {querySelector(selector){assert.ok(fields[selector],selector);return fields[selector]},fields};
}
const scenes=[scene('55.7558','37.6173'),scene()];
const selectors=['close','cancel','apply','center','near','coordinates'];
const controls=Object.fromEntries(selectors.map(k=>[k,element()]));
const selectorsToControls={
 '#tour-geo-picker-close':controls.close,
 '#tour-geo-picker-cancel':controls.cancel,
 '#tour-geo-picker-apply':controls.apply,
 '#tour-geo-picker-center':controls.center,
 '#tour-geo-picker-near':controls.near,
 '#tour-geo-picker-coordinates':controls.coordinates
};
const dialog=element({hidden:true,querySelector(selector){return selectorsToControls[selector]},querySelectorAll(){return []}});
const bodyClasses=new Set();
const document={
 body:{classList:{add(name){bodyClasses.add(name)},remove(name){bodyClasses.delete(name)}}},
 querySelector(selector){return selector==='#tour-geo-picker-dialog'?dialog:null},
 querySelectorAll(selector){return selector==='[data-tour-geo-scope]'?scenes:[]},
 addEventListener(){}
};
let mapClicks=null,marker=null,layerRequests=0;
const map={
 setView(center,zoom){this.center={lat:center[0],lng:center[1]};this.zoom=zoom;return this},
 on(type,callback){if(type==='click')mapClicks=callback;return this},
 invalidateSize(){},getCenter(){return this.center},removeLayer(){marker=null}
};
const L={
 map(){return map},
 tileLayer(){return {addTo(){layerRequests++;return this}}},
 marker(point){
  marker={position:{lat:point[0],lng:point[1]},on(){return this},addTo(){return this},
   setLatLng(pos){this.position={lat:pos[0],lng:pos[1]}},getLatLng(){return this.position}};
  return marker;
 }
};
vm.runInNewContext(source,{document,window:{L},L,navigator:{},URLSearchParams,requestAnimationFrame:callback=>callback()});

// Initial saved coordinates are represented without opening a map or fetching tiles.
assert.match(scenes[0].fields['[data-tour-geo-status]'].textContent,/55\.755800/);
assert.equal(layerRequests,0);
assert.equal(scenes[1].fields['[data-tour-geo-clear]'].disabled,true);

// Clicking a scene's map button opens the modal, picking a point leaves the
// original saved coordinates untouched until the explicit Apply action.
scenes[1].fields['[data-tour-geo-open]'].trigger('click');
assert.equal(dialog.hidden,false);
assert.equal(layerRequests,1);
assert.equal(controls.apply.disabled,true);
mapClicks({latlng:{lat:43.585472,lng:39.723098}});
assert.equal(controls.apply.disabled,false);
assert.equal(scenes[1].fields['[name="geo_lat"]'].value,'');
controls.apply.trigger('click');
assert.equal(dialog.hidden,true);
assert.equal(scenes[1].fields['[name="geo_lat"]'].value,'43.585472');
assert.equal(scenes[1].fields['[name="geo_lng"]'].value,'39.723098');

// Cancelling a later edit keeps the previously applied location.
scenes[1].fields['[data-tour-geo-open]'].trigger('click');
mapClicks({latlng:{lat:44,lng:40}});
controls.cancel.trigger('click');
assert.equal(scenes[1].fields['[name="geo_lat"]'].value,'43.585472');
assert.equal(layerRequests,1,'Map and tile layer are reused after reopening');

scenes[1].fields['[data-tour-geo-clear]'].trigger('click');
assert.equal(scenes[1].fields['[name="geo_lat"]'].value,'');
assert.equal(scenes[1].fields['[name="geo_lng"]'].value,'');
assert.equal(scenes[1].fields['[data-tour-geo-view]'].hidden,true);

console.log('Admin tour map picker: open, place, apply, cancel and clear passed');
