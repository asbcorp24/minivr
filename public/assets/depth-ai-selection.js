// Helpers for choosing a SAM proposal under a user click and mapping it to editor pixels.
export function normalizeMaskValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, n <= 1 ? Math.round(n * 255) : Math.round(n)));
}

export function chooseMaskAtPoint(masks, x, y, width, height) {
  const px = Math.max(0, Math.min(width - 1, Math.floor(x)));
  const py = Math.max(0, Math.min(height - 1, Math.floor(y)));
  const candidates = [];
  for (const item of masks || []) {
    const data = item?.data;
    const mw = Number(item?.width), mh = Number(item?.height);
    if (!data || !mw || !mh || data.length < mw * mh) continue;
    const sx = Math.min(mw - 1, Math.floor((px + .5) * mw / width));
    const sy = Math.min(mh - 1, Math.floor((py + .5) * mh / height));
    const value = normalizeMaskValue(data[sy * mw + sx]);
    if (value < 128) continue;
    let area = 0;
    for (let i = 0; i < mw * mh; i++) if (normalizeMaskValue(data[i]) >= 128) area++;
    if (area < Math.max(8, mw * mh * .00015)) continue;
    candidates.push({ item, area, score: Number(item.score) || 0 });
  }
  // Prefer the tightest valid object proposal, using model confidence as a tie-breaker.
  candidates.sort((a, b) => a.area - b.area || b.score - a.score);
  return candidates[0]?.item || null;
}

export function maskToEditorPixels(data, sourceWidth, sourceHeight, width, height) {
  const out = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(sourceHeight - 1, Math.floor((y + .5) * sourceHeight / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(sourceWidth - 1, Math.floor((x + .5) * sourceWidth / width));
      out[y * width + x] = normalizeMaskValue(data[sy * sourceWidth + sx]);
    }
  }
  return out;
}
