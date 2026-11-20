import assert from 'node:assert/strict';
import * as THREE from '../public/assets/vendor/three/three.module.js';
import {canTranslateDepthCamera,depthOffsetInWorld} from '../public/assets/depth-motion.js';
import {createDesktop3DWindow} from '../public/assets/desktop-3d-window.js';

// Desktop pointer parallax remains on even without phone motion.
assert.equal(canTranslateDepthCamera('desktop',false,false),true);
assert.equal(canTranslateDepthCamera('desktop',false,true),true);

// GYRO alone rotates the camera. Explicitly enabled 3D adds translation.
assert.equal(canTranslateDepthCamera('desktop',true,false),false);
assert.equal(canTranslateDepthCamera('desktop',true,true),true);

// A rotation drag must be a pure viewpoint rotation, including phone GYRO 3D.
assert.equal(canTranslateDepthCamera('desktop',false,false,true),false);
assert.equal(canTranslateDepthCamera('desktop',true,true,true),false);
assert.equal(canTranslateDepthCamera('desktop',false,false,false),true,
 'Pointer parallax must still work outside a rotation drag');

// Release all spring inertia when the user starts rotating the panorama;
// an old pointer offset must not return as soon as the drag is released.
const desktopWindow=createDesktop3DWindow();
for(let i=0;i<20;i++)desktopWindow.update(1/60,true,{x:1,y:.5});
assert.ok(Math.abs(desktopWindow.update(0,true,{x:1,y:.5}).x)>.01);
desktopWindow.reset();
assert.deepEqual(desktopWindow.update(0,true,{x:0,y:0}),{x:0,y:0});

// Cardboard and WebXR must not inherit synthetic camera position.
for(const mode of ['cardboard','webxr']){
 for(const gyro of [false,true]){
  for(const phone3D of [false,true]){
   assert.equal(canTranslateDepthCamera(mode,gyro,phone3D),false);
  }
 }
}

const local=new THREE.Vector3(1,2,.5);
const target=new THREE.Vector3();
const identity=new THREE.Quaternion();
const close=(actual,expected)=>assert(actual.distanceTo(expected)<1e-9,
 `Expected ${actual.toArray()} to equal ${expected.toArray()}`);

// The previous desktop yaw convention is unchanged.
close(depthOffsetInWorld(local,false,identity,0,target),local);
close(depthOffsetInWorld(local,false,identity,Math.PI/2,target),new THREE.Vector3(-.5,2,1));

// In GYRO the same phone-relative offset tracks the actual camera rotation,
// including pitch/roll, without falling back to stale mouse-look yaw.
const pitch=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0),Math.PI/2);
close(depthOffsetInWorld(new THREE.Vector3(0,1,0),true,pitch,99,target),new THREE.Vector3(0,0,1));
const yaw=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI/2);
close(depthOffsetInWorld(new THREE.Vector3(1,0,0),true,yaw,0,target),new THREE.Vector3(0,0,-1));
assert.equal(depthOffsetInWorld(local,true,identity,0,target),target,'Reuse the destination vector');

console.log('Depth motion mode and GYRO orientation tests passed');
