import assert from 'node:assert/strict';
import { anglesToDirection, directionToAngles, validHotspotAngles } from '../public/assets/hotspot-import-geometry.js';

for (const yaw of [-180, -179.9, -135, -45, 0, 45, 135, 179.9, 180]) {
  for (const pitch of [-89, -30, 0, 25, 89]) {
    const direction = anglesToDirection(yaw, pitch);
    const result = directionToAngles(direction);
    assert.ok(Math.abs(result.pitch - pitch) < 1e-9, `pitch ${pitch}`);
    assert.ok(Math.abs(Math.abs(result.yaw - yaw) % 360) < 1e-9 || Math.abs(Math.abs(result.yaw - yaw) - 360) < 1e-9, `yaw ${yaw}`);
    assert.ok(Math.abs(Math.hypot(direction.x, direction.y, direction.z) - 1) < 1e-9);
  }
}
const left = anglesToDirection(-180, 30);
const right = anglesToDirection(180, 30);
assert.ok(Math.hypot(left.x - right.x, left.y - right.y, left.z - right.z) < 1e-12, '0°/360° seam connects');
assert.ok(validHotspotAngles(-180, -90) && validHotspotAngles(180, 90));
assert.ok(!validHotspotAngles(181, 0) && !validHotspotAngles(0, NaN));
assert.throws(() => directionToAngles({ x: 0, y: 0, z: 0 }), RangeError);
console.log('hotspot-import-geometry: seam, round-trip, poles and invalid coordinates passed');
