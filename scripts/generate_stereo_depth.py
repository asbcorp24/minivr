#!/usr/bin/env python3
"""Generate a relative depth map from an SBS/TB stereo pair using pretrained RAFT optical flow.
Install: pip install torch torchvision pillow numpy
The first run downloads torchvision's pretrained RAFT-Small weights (requires internet).
"""
import argparse
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--format", choices=["sbs", "tb"], required=True)
    parser.add_argument("--max-width", type=int, default=768)
    args = parser.parse_args()
    import numpy as np
    import torch
    import torch.nn.functional as F
    from PIL import Image, ImageFilter
    from torchvision.models.optical_flow import raft_small, Raft_Small_Weights

    image = Image.open(args.input).convert("RGB")
    w, h = image.size
    if args.format == "sbs":
        if w % 2: raise ValueError("SBS image width must be even")
        left = image.crop((0, 0, w//2, h))
        right = image.crop((w//2, 0, w, h))
    else:
        if h % 2: raise ValueError("TB image height must be even")
        left = image.crop((0, 0, w, h//2))
        right = image.crop((0, h//2, w, h))
    ew, eh = left.size
    if ew < 64 or eh < 64: raise ValueError("Stereo eyes too small")
    scale = min(1.0, args.max_width / ew)
    rw = max(64, int(ew*scale)//8*8)
    rh = max(64, int(eh*scale)//8*8)
    left = left.resize((rw, rh), Image.Resampling.LANCZOS)
    right = right.resize((rw, rh), Image.Resampling.LANCZOS)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    weights = Raft_Small_Weights.DEFAULT
    model = raft_small(weights=weights, progress=True).to(device).eval()
    transform = weights.transforms()
    a = torch.from_numpy(np.asarray(left).copy()).permute(2,0,1).unsqueeze(0)
    b = torch.from_numpy(np.asarray(right).copy()).permute(2,0,1).unsqueeze(0)
    a, b = transform(a, b)
    with torch.inference_mode():
        flow = model(a.to(device), b.to(device))[-1][0].cpu().numpy()
    # Optical flow from left to right: rectified stereo disparity is -horizontal flow.
    disparity = -flow[0]
    vertical = np.abs(flow[1])
    confidence = (vertical < max(2.0, rh*.015)) & np.isfinite(disparity)
    samples = disparity[confidence]
    if samples.size < rw*rh*.12: raise ValueError("Not enough consistent stereo correspondences")
    low, high = np.percentile(samples, [8, 92])
    if high-low < .5: raise ValueError("Stereo pair has insufficient measurable disparity")
    depth = np.clip((disparity-low)/(high-low), 0, 1)
    depth[~confidence] = 0
    # A broad blur suppresses optical flow noise that would create sharp mesh spikes.
    gray = Image.fromarray(np.uint8(np.round(depth*255)), mode="L")
    gray = gray.filter(ImageFilter.MedianFilter(size=5)).filter(ImageFilter.GaussianBlur(radius=3))
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    gray.save(output, format="PNG")
    print(f"Saved relative stereo depth {rw}x{rh} ({device}) to {output}")

if __name__ == "__main__":
    main()
