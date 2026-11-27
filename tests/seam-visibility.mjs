import assert from 'node:assert/strict';
import {seamViewportPenetration} from '../public/assets/seam-visibility.js';

const width=400,height=300;
assert.deepEqual(seamViewportPenetration([{x:-1,y:150}],width,height),{depth:0,visibleSamples:0},
 'A seam outside the viewport is not visible');
assert.deepEqual(seamViewportPenetration([{x:15,y:150}],width,height),{depth:15,visibleSamples:1},
 'A seam exactly 15px inside the left edge reaches the stop threshold');
assert.deepEqual(seamViewportPenetration([{x:385,y:150}],width,height),{depth:15,visibleSamples:1},
 'The right edge uses the same threshold');
assert.deepEqual(seamViewportPenetration([{x:200,y:15}],width,height),{depth:15,visibleSamples:1},
 'The top edge is measured in screen pixels');
assert.deepEqual(seamViewportPenetration([{x:200,y:285}],width,height),{depth:15,visibleSamples:1},
 'The bottom edge is measured in screen pixels');
assert.deepEqual(seamViewportPenetration([{x:30,y:150},{x:200,y:150}],width,height),{depth:150,visibleSamples:2},
 'The deepest visible seam sample determines penetration');
assert.deepEqual(seamViewportPenetration([{x:20,y:10},{x:410,y:20}],width,height),{depth:10,visibleSamples:1},
 'Only samples inside the viewport contribute');

console.log('Projected panorama seam geometry tests passed');
