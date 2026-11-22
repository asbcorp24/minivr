/** The same longitude/latitude convention as MiniVR's spherical hotspot editor. */
export function anglesToDirection(yaw, pitch) {
  const longitude = yaw * Math.PI / 180;
  const latitude = pitch * Math.PI / 180;
  return {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.sin(latitude),
    z: Math.cos(latitude) * Math.sin(longitude),
  };
}

export function directionToAngles({ x, y, z }) {
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length === 0) throw new RangeError('Невозможно вычислить направление');
  const yaw = Math.atan2(z, x) * 180 / Math.PI;
  const pitch = Math.asin(Math.max(-1, Math.min(1, y / length))) * 180 / Math.PI;
  return { yaw, pitch };
}

export function validHotspotAngles(yaw, pitch) {
  return Number.isFinite(yaw) && yaw >= -180 && yaw <= 180 &&
    Number.isFinite(pitch) && pitch >= -90 && pitch <= 90;
}
