import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/assets/depth-ai-selection.js', import.meta.url));
const { chooseMaskAtPoint, maskToEditorPixels, normalizeMaskValue } =
  await import('data:text/javascript;base64,' + source.toString('base64'));

assert.equal(normalizeMaskValue(0), 0);
assert.equal(normalizeMaskValue(1), 255);
assert.equal(normalizeMaskValue(127.6), 128);
assert.equal(normalizeMaskValue(999), 255);

const small = { width: 4, height: 4, score: .8, data: new Uint8Array([
  0,0,0,0, 0,255,255,0, 0,255,255,0, 0,0,0,0
]) };
const large = { width: 4, height: 4, score: .9, data: new Uint8Array([
  255,255,255,255, 255,255,255,255, 255,255,255,255, 255,255,255,255
]) };
assert.equal(chooseMaskAtPoint([small, large], 1, 1, 4, 4), small,
  'Click chooses the tightest object mask that contains the selected point');
assert.equal(chooseMaskAtPoint([small], 0, 0, 4, 4), null,
  'Click outside every proposal returns no selection');
assert.equal(chooseMaskAtPoint([small], -100, -100, 4, 4), null,
  'Out-of-bounds clicks are safely clamped');

const scaled = maskToEditorPixels(new Uint8Array([0,255,255,0]), 2, 2, 4, 4);
assert.deepEqual([...scaled], [
  0,0,255,255, 0,0,255,255,
  0,0,255,255, 0,0,255,255
], 'Model mask is resized to the editor canvas without changing its orientation');

console.log('AI click-to-select mask helper tests passed');
