import assert from 'node:assert/strict';
import { requestGyroSample, validGyroSample, GYRO_SAMPLE_TIMEOUT_MS } from '../public/assets/gyro-sensor.js';

class FakeWindow extends EventTarget {
  constructor() {
    super();
    this.isSecureContext = true;
    this.DeviceOrientationEvent = function DeviceOrientationEvent() {};
    this.listeners = new Set();
  }
  addEventListener(type, callback, options) {
    super.addEventListener(type, callback, options);
    if (type.startsWith('deviceorientation')) this.listeners.add(callback);
  }
  removeEventListener(type, callback, options) {
    super.removeEventListener(type, callback, options);
    if (type.startsWith('deviceorientation')) this.listeners.delete(callback);
  }
  emit(type, alpha = 0, beta = 0, gamma = 0) {
    const event = new Event(type);
    Object.assign(event, { alpha, beta, gamma });
    this.dispatchEvent(event);
  }
}

assert.equal(GYRO_SAMPLE_TIMEOUT_MS, 6000, 'Tablet startup must allow more than 1.2 seconds');
assert.ok(validGyroSample({ alpha: 0, beta: 0, gamma: 0 }), 'Zero angles are valid');
assert.ok(!validGyroSample({ alpha: null, beta: 1, gamma: 0 }));

const http = new FakeWindow();
http.isSecureContext = false;
assert.equal((await requestGyroSample(http)).status, 'insecure');
assert.equal(http.listeners.size, 0);

const unsupported = new FakeWindow();
delete unsupported.DeviceOrientationEvent;
assert.equal((await requestGyroSample(unsupported)).status, 'unsupported');

const safari = new FakeWindow();
let synchronousPermissionRequest = false;
safari.DeviceOrientationEvent.requestPermission = () => {
  synchronousPermissionRequest = true;
  return Promise.resolve('granted');
};
const safariStart = requestGyroSample(safari, { timeoutMs: 25 });
assert.equal(synchronousPermissionRequest, true, 'iPad permission prompt must start inside the click handler');
await Promise.resolve();
safari.emit('deviceorientation', 14, 5, 2);
assert.equal((await safariStart).status, 'ready');

const denied = new FakeWindow();
let attempts = 0;
denied.DeviceOrientationEvent.requestPermission = async () => ++attempts === 1 ? 'denied' : 'granted';
assert.equal((await requestGyroSample(denied)).status, 'denied');
setTimeout(() => denied.emit('deviceorientation', 11, -2, 9), 12);
assert.equal((await requestGyroSample(denied, { timeoutMs: 80 })).status, 'ready', 'Retry must request permission again');
assert.equal(attempts, 2);
assert.equal(denied.listeners.size, 0, 'Successful startup removes temporary listeners');

const absoluteOnly = new FakeWindow();
setTimeout(() => absoluteOnly.emit('deviceorientationabsolute', 0, 15, -30), 12);
const absoluteResult = await requestGyroSample(absoluteOnly, { timeoutMs: 80 });
assert.equal(absoluteResult.status, 'ready');
assert.equal(absoluteResult.source, 'deviceorientationabsolute', 'Android absolute-only sensor is supported');
assert.equal(absoluteOnly.listeners.size, 0);

const empty = new FakeWindow();
assert.equal((await requestGyroSample(empty, { timeoutMs: 20 })).status, 'no-events');
assert.equal(empty.listeners.size, 0, 'Timeout removes listeners');

const invalid = new FakeWindow();
setTimeout(() => invalid.emit('deviceorientation', null, 25, 2), 5);
assert.equal((await requestGyroSample(invalid, { timeoutMs: 25 })).status, 'invalid-data');
assert.equal(invalid.listeners.size, 0);

const permissionError = new FakeWindow();
permissionError.DeviceOrientationEvent.requestPermission = () => { throw Object.assign(new Error('blocked'), { name: 'NotAllowedError' }); };
assert.equal((await requestGyroSample(permissionError)).status, 'permission-error');

const cancelled = new FakeWindow();
const controller = new AbortController();
const pending = requestGyroSample(cancelled, { timeoutMs: 200, signal: controller.signal });
controller.abort();
assert.equal((await pending).status, 'cancelled');
assert.equal(cancelled.listeners.size, 0, 'Abort releases listeners');

console.log('gyro-sensor: secure context, permission, retry, Android absolute events, timeout, malformed angles and abort passed');
