#!/usr/bin/env python3
"""Download MiniVR model assets for static hosting on Timeweb.

Run on your own computer (not on shared hosting):
    python -m pip install huggingface_hub
    python scripts/download_ai_models.py
Then upload public/assets/models/ to the matching Timeweb directory.
"""
from pathlib import Path
from urllib.request import urlopen
import shutil

from huggingface_hub import snapshot_download, hf_hub_download

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "public" / "assets" / "models"
MODELS.mkdir(parents=True, exist_ok=True)

depth_repo = "onnx-community/depth-anything-v2-small"
depth_dir = MODELS / depth_repo
depth_dir.mkdir(parents=True, exist_ok=True)
print("Downloading Depth Anything V2 Small model files...")
snapshot_download(
    repo_id=depth_repo,
    local_dir=str(depth_dir),
    allow_patterns=["*.json", "*.onnx", "*.onnx_data", "*.txt"],
)
print("Downloading DeepFill v2 model...")
source = hf_hub_download(
    repo_id="vooxyou/deepfillv2-inpainting",
    filename="deepfillv2_quantized.onnx",
)
shutil.copyfile(source, MODELS / "deepfillv2_quantized.onnx")
print("Ready:", MODELS)
print("Upload this directory to /public/assets/models/ on Timeweb.")
