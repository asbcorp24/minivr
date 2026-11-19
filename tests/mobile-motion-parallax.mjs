import assert from 'node:assert/strict';
import {createMobileMotionParallax} from '../public/assets/mobile-motion-parallax.js';

function mockPhone(){
 const listeners=new Map();
 const phone={
  isSecureContext:true,
  DeviceOrientationEvent:{},
  screen:{orientation:{angle:0,addEventListener(){},removeEventListener(){}}},
  addEventListener(name,listener){listeners.set(name,listener)},
  removeEventListener(name){listeners.delete(name)},
  emit(name,data){listeners.get(name)?.(data)},
  has(name){return listeners.has(name)}
 };
 return phone;
}

const insecure=mockPhone();insecure.isSecureContext=false;
assert.equal(await createMobileMotionParallax(insecure).start(),false);

const denied=mockPhone();denied.DeviceOrientationEvent.requestPermission=async()=>'denied';
assert.equal(await createMobileMotionParallax(denied).start(),false);
assert.equal(denied.has('deviceorientation'),false);

const allowed=mockPhone();allowed.DeviceOrientationEvent.requestPermission=async()=>'granted';
const allowedParallax=createMobileMotionParallax(allowed);
const allowedStart=allowedParallax.start();
await Promise.resolve();
allowed.emit('deviceorientation',{beta:0,gamma:0});
assert.equal(await allowedStart,true);
allowedParallax.stop();

const phone=mockPhone();
const parallax=createMobileMotionParallax(phone);
const started=parallax.start();
phone.emit('deviceorientation',{beta:10,gamma:5});
assert.equal(await started,true);
assert.equal(parallax.isActive(),true);
assert.deepEqual(parallax.update(.03),{x:0,y:0});

phone.emit('deviceorientation',{beta:17,gamma:27});
const moved=parallax.update(.05);
assert(moved.x>.1&&moved.x<1,'Horizontal tilt must be bounded and smoothed');
assert(moved.y<0&&moved.y>-1,'Vertical tilt must be bounded and smoothed');

parallax.recenter();
phone.emit('deviceorientation',{beta:17,gamma:27});
assert.deepEqual(parallax.update(.05),{x:0,y:0});

phone.emit('deviceorientation',{beta:17,gamma:37});
assert(parallax.update(.05).x>.15,'A 10° portrait tilt should be perceptible after smoothing');
parallax.recenter();

phone.screen.orientation.angle=90;
phone.emit('deviceorientation',{beta:17,gamma:27});
assert.deepEqual(parallax.update(.05),{x:0,y:0});
phone.emit('deviceorientation',{beta:39,gamma:27});
assert(parallax.update(.05).x<0,'Landscape should use the rotated phone axes');

parallax.stop();
assert.equal(phone.has('deviceorientation'),false);
assert.equal(parallax.isActive(),false);
assert.deepEqual(parallax.update(.05),{x:0,y:0});
console.log('Mobile motion parallax tests passed');
