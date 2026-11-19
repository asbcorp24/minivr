import assert from 'node:assert/strict';
import {tourScenePoint,tourMapEmbedUrl,tourMapExternalUrl} from '../public/assets/tour-geo-map.js';

assert.equal(tourScenePoint({geo_lat:null,geo_lng:null}),null);
assert.equal(tourScenePoint({geo_lat:'',geo_lng:'31'}),null);
assert.equal(tourScenePoint({geo_lat:'91',geo_lng:'30'}),null);
assert.equal(tourScenePoint({geo_lat:0,geo_lng:-181}),null);
assert.equal(tourScenePoint({geo_lat:'NaN',geo_lng:4}),null);
assert.deepEqual(tourScenePoint({geo_lat:'0',geo_lng:'0'}),{lat:0,lng:0});

const point=tourScenePoint({geo_lat:'55.7558',geo_lng:'37.6173'});
const embed=new URL(tourMapEmbedUrl(point));
assert.equal(embed.origin,'https://www.openstreetmap.org');
assert.equal(embed.pathname,'/export/embed.html');
assert.equal(embed.searchParams.get('marker'),'55.7558,37.6173');
assert.deepEqual(embed.searchParams.get('bbox').split(',').map(Number),[37.6053,55.7498,37.6293,55.7618]);

const full=new URL(tourMapExternalUrl(point));
assert.equal(full.searchParams.get('mlat'),'55.7558');
assert.equal(full.searchParams.get('mlon'),'37.6173');
assert.equal(full.hash,'#map=16/55.7558/37.6173');

console.log('Tour geo map validates real points and OpenStreetMap links');
