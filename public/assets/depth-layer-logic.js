// The viewer creates soft, overlapping groups from one grayscale depth map.
// Keep the manual editor's layer selection and paint targets in that same space.
export function depthGroupCount(value) {
  return Math.max(2, Math.min(10, Math.round(Number(value) || 5)));
}

export function renderedDepth(raw, nonlinear = false, nonlinearStrength = 50) {
  const depth = Math.max(0, Math.min(1, raw));
  if (!nonlinear) return depth;
  const strength = Math.max(0, Math.min(100, Number(nonlinearStrength) || 0)) / 100;
  return depth * (1 - strength) + Math.pow(depth, 2.2) * strength;
}

export function layerCoverage(raw, band, count, nonlinear = false, nonlinearStrength = 50) {
  const center = (band + .5) / count;
  const distance = Math.abs(renderedDepth(raw, nonlinear, nonlinearStrength) - center);
  return Math.max(0, Math.min(1, (1 / count - distance) / (.5 / count)));
}

// Invert the viewer's optional near-field depth curve so a painted layer lands
// at the requested group center even with nonlinear parallax enabled.
export function rawForRenderedDepth(target, nonlinear = false, nonlinearStrength = 50) {
  const value = Math.max(0, Math.min(1, target));
  if (!nonlinear || nonlinearStrength <= 0) return value;
  let lo = 0, hi = 1;
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (renderedDepth(mid, nonlinear, nonlinearStrength) < value) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function rawForLayer(band, count, nonlinear = false, nonlinearStrength = 50) {
  return rawForRenderedDepth((band + .5) / count, nonlinear, nonlinearStrength);
}

// The saved format is still one map: removing a pixel from a group must move
// its depth just outside that group's coverage, into an adjacent depth range.
export function rawOutsideLayer(raw, band, count, nonlinear = false, nonlinearStrength = 50) {
  if (layerCoverage(raw, band, count, nonlinear, nonlinearStrength) === 0) return raw;
  const center = (band + .5) / count;
  const current = renderedDepth(raw, nonlinear, nonlinearStrength);
  const lower = center - 1 / count - .012;
  const upper = center + 1 / count + .012;
  const candidates = [lower, upper].filter(v => v >= 0 && v <= 1);
  if (!candidates.length) return raw;
  const closest = candidates.reduce((a, b) => Math.abs(a - current) <= Math.abs(b - current) ? a : b);
  return rawForRenderedDepth(closest, nonlinear, nonlinearStrength);
}
