// Small, panorama-global depth-edge mask shared by every tile and depth band.
// No full-resolution image or per-tile contact texture is created.
export function makeTileContactShadowMask(pixels, nonlinear = 0) {
  const width = 256, height = 128;
  if (!pixels || pixels.length !== width * height * 4) throw new Error('Invalid contact-shadow depth atlas');
  nonlinear = Math.max(0, Math.min(1, Number(nonlinear) || 0));
  const depth = new Float32Array(width * height);
  for (let i = 0; i < depth.length; i++) {
    const raw = pixels[i * 4] / 255;
    depth[i] = raw * (1 - nonlinear) + Math.pow(raw, 2.2) * nonlinear;
  }
  const mask = new Uint8Array(width * height * 4);
  const neighbors = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1]];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const base = depth[y * width + x];
    let edge = 0;
    for (const [dx, dy] of neighbors) {
      const xx = (x + dx + width) % width;
      const yy = Math.max(0, Math.min(height - 1, y + dy));
      const difference = depth[yy * width + xx] - base;
      if (difference > .06) edge = Math.max(edge, Math.min(1, (difference - .06) * 3.5));
    }
    const index = (y * width + x) * 4;
    mask[index] = Math.round(edge * 255);
    mask[index + 3] = 255;
  }
  return mask;
}

export const WATER_KINDS = Object.freeze({ calm: 0, sea: 1, river: 2, waterfall: 3, underwater: 4, surf: 5 });

// Periodic longitude phases ensure 0° and 360° share the same displacement.
// `waterShift` is in panorama-global UV units; callers convert it to tile UV.
export function tileWaterShift(u, v, time, kind = 'calm', direction = 0) {
  const angle = Number.isFinite(direction) ? direction : 0;
  const waterKind = WATER_KINDS[kind] ?? 0;
  const waves = Math.sin(v * (waterKind === 1 ? 120 : 75) + time * (waterKind === 1 ? 3.4 : 1.8)
    + Math.sin(u * Math.PI * 2 * 6 + time) * .7);
  const ripples = Math.sin(u * Math.PI * 2 * 26 + time * 2.1) * Math.cos(v * 145 - time * 1.4);
  let x = waves * .0025 + ripples * .0008;
  let y = ripples * .0013;
  if (waterKind === 1) { x += Math.sin(v * 52 + time * 2.5) * .003; y += Math.cos(u * Math.PI * 2 * 5 - time) * .001; }
  if (waterKind === 2) { const flow = .003 * Math.sin(time * 1.8 + v * 100); x += Math.cos(angle) * flow; y += Math.sin(angle) * flow; }
  if (waterKind === 3) { x += ripples * .001; y += .005 * Math.sin(time * 2.5 + v * 90); }
  if (waterKind === 4) { x *= .45; y *= .45; }
  if (waterKind === 5) {
    const near = smoothstep(.18, .78, 1 - v);
    const a = v * 21 - time * 1.18 + Math.sin(u * Math.PI * 2 * 2 + time * .17) * .24;
    const b = v * 35 - time * 1.67 + Math.sin(u * Math.PI * 2 * 3 - time * .11) * .17;
    const crestA = Math.pow(Math.max(0, Math.cos(a)), 12);
    const crestB = Math.pow(Math.max(0, Math.cos(b + 1.7)), 16);
    const forward = (.0018 + .0024 * near) * (crestA * .85 + crestB * .35);
    const backwash = Math.sin(a - 1) * (.0005 + .0007 * near);
    const foamDrift = Math.sin(u * Math.PI * 2 * 13 + b * 1.3) * crestA * .0007;
    const flow = (.0015 + .0012 * near) * (crestA + crestB * .4);
    x = foamDrift + Math.sin(a) * .00055 + Math.cos(angle) * flow;
    y = forward + backwash + Math.sin(angle) * flow;
  }
  const gust = .88 + .12 * Math.sin(time * .23 + u * Math.PI * 2 * 3);
  return { x: x * gust, y: y * gust };
}

function smoothstep(a, b, v) {
  const t = Math.max(0, Math.min(1, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Generates the GPU equivalent of tileWaterShift; no non-periodic longitude
// expressions and no samples outside a tile's texture bounds.
export function tileWaterShader(kind = 'calm', direction = 0) {
  const id = WATER_KINDS[kind] ?? 0;
  const angle = (Number.isFinite(direction) ? direction : 0).toFixed(6);
  return `
  vec2 panoramaTopUv = waterTileTransform.xy + vec2(waterUv.x,1.0-waterUv.y)*waterTileTransform.zw;
  vec2 panoramaUv = vec2(panoramaTopUv.x,1.0-panoramaTopUv.y);
  float waterCoverage = smoothstep(.02,.28,texture2D(waterMotionMask,panoramaUv).a);
  // Skip all wave trigonometry over sky, buildings and other unmasked pixels.
  if(waterCoverage>.001 && waterMotionStrength>.001){
  float wt = waterMotionTime;
  float waves = sin(panoramaUv.y*${id===1?'120.0':'75.0'}+wt*${id===1?'3.4':'1.8'}+sin(panoramaUv.x*6.28318530718*6.0+wt)*.7);
  float ripples = sin(panoramaUv.x*6.28318530718*26.0+wt*2.1)*cos(panoramaUv.y*145.0-wt*1.4);
  vec2 flowDirection=vec2(cos(${angle}),sin(${angle}));
  vec2 waterShift=vec2(waves*.0025+ripples*.0008,ripples*.0013);
  ${id===1?'waterShift+=vec2(sin(panoramaUv.y*52.0+wt*2.5)*.003,cos(panoramaUv.x*6.28318530718*5.0-wt)*.001);':''}
  ${id===2?'waterShift+=flowDirection*(.003*sin(wt*1.8+panoramaUv.y*100.0));':''}
  ${id===3?'waterShift+=vec2(ripples*.001,.005*sin(wt*2.5+panoramaUv.y*90.0));':''}
  ${id===4?'waterShift*=.45;':''}
  ${id===5?`
    float surfNear=smoothstep(.18,.78,1.0-panoramaUv.y);
    float phaseA=panoramaUv.y*21.0-wt*1.18+sin(panoramaUv.x*6.28318530718*2.0+wt*.17)*.24;
    float phaseB=panoramaUv.y*35.0-wt*1.67+sin(panoramaUv.x*6.28318530718*3.0-wt*.11)*.17;
    float crestA=pow(max(0.0,cos(phaseA)),12.0);
    float crestB=pow(max(0.0,cos(phaseB+1.7)),16.0);
    float forward=(.0018+.0024*surfNear)*(crestA*.85+crestB*.35);
    float backwash=sin(phaseA-1.0)*(.0005+.0007*surfNear);
    float foamDrift=sin(panoramaUv.x*6.28318530718*13.0+phaseB*1.3)*crestA*.0007;
    waterShift=vec2(foamDrift+sin(phaseA)*.00055,forward+backwash);
    waterShift+=flowDirection*(.0015+.0012*surfNear)*(crestA+crestB*.4);
  `:''}
  waterShift*=waterCoverage*waterMotionStrength*(.88+.12*sin(wt*.23+panoramaUv.x*6.28318530718*3.0));
  // Convert global panorama displacement to local tile UV. The exact edge
  // stays unmoved, including longitude 0°/360° and mismatched LOD borders.
  vec2 localWaterShift=waterShift/max(waterTileTransform.zw,vec2(.00001));
  float edgeDistance=min(min(waterUv.x,1.0-waterUv.x),min(waterUv.y,1.0-waterUv.y));
  float tileEdge=smoothstep(0.0,.06,edgeDistance);
  localWaterShift*=tileEdge;
  float safeTravel=max(0.0,edgeDistance-.0001);
  localWaterShift*=min(1.0,safeTravel/max(max(abs(localWaterShift.x),abs(localWaterShift.y)),.00001));
  waterUv=clamp(waterUv+localWaterShift,vec2(0.0),vec2(1.0));
  }
  `;
}
