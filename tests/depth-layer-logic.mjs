import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
// The browser serves this .js file as an ES module; Node's test runner loads
// the same source through a data URL without changing this project's module type.
const source = await readFile(new URL('../public/assets/depth-layer-logic.js', import.meta.url));
const {
  depthGroupCount, renderedDepth, layerCoverage,
  rawForRenderedDepth, rawForLayer, rawOutsideLayer,
  fittedPanoramaSize, boundedPanOffsets
} = await import('data:text/javascript;base64,' + source.toString('base64'));

assert.equal(depthGroupCount(undefined), 5);
assert.equal(depthGroupCount(1), 2);
assert.equal(depthGroupCount(99), 10);
assert.equal(depthGroupCount(4), 4);

for (const nonlinear of [false, true]) {
  for (const n of [2, 5, 10]) {
    for (let band = 0; band < n; band++) {
      const center = (band + .5) / n;
      const painted = rawForLayer(band, n, nonlinear, 70);
      assert.ok(Math.abs(renderedDepth(painted, nonlinear, 70) - center) < .00001,
        'Painting a band should use the inverse viewer depth curve');
      assert.equal(layerCoverage(painted, band, n, nonlinear, 70), 1);
      const removed = rawOutsideLayer(painted, band, n, nonlinear, 70);
      assert.equal(layerCoverage(removed, band, n, nonlinear, 70), 0,
        'Removing from a band must take the pixel outside its soft mask');
    }
  }
}

for (let value = 0; value <= 1; value += .05) {
  const raw = rawForRenderedDepth(value, true, 80);
  assert.ok(Math.abs(renderedDepth(raw, true, 80) - value) < .00001);
}

assert.equal(rawOutsideLayer(.99, 0, 5), .99,
  'Removing an already absent pixel should preserve its depth');
assert.equal(renderedDepth(.5, false, 100), .5,
  'Disabling nonlinear depth must keep the original depth values');

assert.deepEqual(fittedPanoramaSize(1500, 600), { width: 1200, height: 600 },
  'Fullscreen panorama fits available height without aspect ratio distortion');
assert.deepEqual(fittedPanoramaSize(375, 600), { width: 375, height: 187.5 },
  'Portrait phone keeps the 2:1 panorama and can zoom in separately');
assert.deepEqual(boundedPanOffsets(1000, -1000, 2, 1000, 500, 1000, 700), { x: 500, y: -150 },
  'Panning remains bounded to the image at 200% zoom');
assert.deepEqual(boundedPanOffsets(100, -100, 1, 375, 187.5, 375, 600), { x: 0, y: 0 },
  'Image cannot drift away from its frame at 100% zoom');

console.log('Manual depth layer coverage, zoom, fit and pan boundary tests passed');
