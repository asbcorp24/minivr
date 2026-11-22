import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { makeTileContactShadowMask, tileWaterShader, tileWaterShift, WATER_KINDS } from '../public/assets/tile-environment-effects.js';

const width = 256, height = 128;
const pixels = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
  const index = (y * width + x) * 4;
  // An edge just across the 0°/360° seam must cast onto the last column.
  pixels[index] = x === 0 || x >= 90 && x < 140 ? 225 : 30;
  pixels[index + 3] = 255;
}
const start = performance.now();
const shadow = makeTileContactShadowMask(pixels, .4);
const elapsed = performance.now() - start;
assert.equal(shadow.length, width * height * 4, 'Contact shadows use only one 256x128 atlas');
assert.ok(elapsed < 1500, `Small shared mask should be cheap to build: ${elapsed.toFixed(1)}ms`);
const at = (x, y) => shadow[(y * width + x) * 4];
assert.ok(at(255, 64) > 0, 'Contact shadow reads nearby depth through the longitude seam');
assert.ok(at(89, 64) > 0, 'Near-side depth discontinuity makes a contact shadow');
assert.equal(at(50, 64), 0, 'Constant-depth sky must not get darkened');
assert.equal(shadow[(64 * width + 50) * 4 + 3], 255, 'Mask alpha is opaque');
assert.throws(() => makeTileContactShadowMask(new Uint8Array(20)), /Invalid/);

for (const kind of Object.keys(WATER_KINDS)) {
  const shader = tileWaterShader(kind, Math.PI / 4);
  assert.match(shader, /texture2D\(waterMotionMask,panoramaUv\)\.a/,'Manual alpha mask must control water');
  assert.match(shader, /float tileEdge=smoothstep\(0\.0,\.06,edgeDistance\)/);
  assert.match(shader, /float safeTravel=max\(0\.0,edgeDistance-\.0001\)/,'Displacement stays inside each tile');
  assert.match(shader, /waterShift\/max\(waterTileTransform\.zw/,'Global UV motion is stable across LODs');
  for (const time of [0, .17, 7.8, 123.45]) for (const v of [.02, .25, .5, .95]) {
    const first = tileWaterShift(0, v, time, kind, Math.PI / 4);
    const seam = tileWaterShift(1, v, time, kind, Math.PI / 4);
    assert.ok(Math.abs(first.x - seam.x) < 1e-12 && Math.abs(first.y - seam.y) < 1e-12,
      `Longitude 0°/360° water phase must meet for ${kind} at time ${time}`);
    assert.ok(Number.isFinite(first.x) && Number.isFinite(first.y));
    assert.ok(Math.max(Math.abs(first.x), Math.abs(first.y)) < .03, 'Motion stays bounded');
  }
}

console.log(`tile-environment-effects: six water styles, periodic seam, GPU-safe edges and 256x128 contact mask (${elapsed.toFixed(1)}ms) passed`);
