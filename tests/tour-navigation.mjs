import assert from 'node:assert/strict';
import {shouldSwitchSceneInPlace} from '../public/assets/tour-navigation.js';

const origin='https://vr.example.test';
const tourId=12;
const scenes=[{id:41,panorama_id:82},{id:42,panorama_id:83}];
const scene=new URL('/viewer.php?id=83&tour=12&scene=42',origin);
const internal=(url,mode='desktop')=>shouldSwitchSceneInPlace(new URL(url,origin),origin,tourId,scenes,mode);

// Auto-next, tour rail, hotspot and gallery navigation all use in-place mode.
for(const mode of ['desktop','cardboard','webxr'])assert.equal(internal(scene,mode),true);
assert.equal(internal('/viewer.php?id=82&tour=12&scene=41'),true);
assert.equal(internal('/viewer.php?id=83&tour=13&scene=42'),false);
assert.equal(internal('/viewer.php?id=99&tour=12&scene=42'),false);
assert.equal(internal('/viewer.php?id=83&tour=12&scene=999'),false);
assert.equal(internal('/tour.php?id=12'),false);
assert.equal(internal('https://external.example/viewer.php?id=83&tour=12&scene=42'),false);

// Immersive modes also preserve the session when following a viewer hotspot
// outside a tour; ordinary standalone navigation retains its old behavior.
const standalone=new URL('/viewer.php?id=10',origin);
assert.equal(shouldSwitchSceneInPlace(standalone,origin,0,[], 'desktop'),false);
assert.equal(shouldSwitchSceneInPlace(standalone,origin,0,[], 'cardboard'),true);
assert.equal(shouldSwitchSceneInPlace(standalone,origin,0,[], 'webxr'),true);

console.log('Tour navigation mode preservation tests passed');
