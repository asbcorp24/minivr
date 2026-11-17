# Stereo AI depth maps for MiniVR image hotspots

The admin page **Admin → Tour → Scene → Hotspots** offers **Создать карту глубины AI** for SBS and TB image hotspots. The generated grayscale PNG is saved in `public/uploads/stereo-depth/` and its URL in `hotspots.depth_map` (automatic SQLite migration). Brighter pixels mean nearer surfaces. The image hotspot's original stereo file is unchanged.

## Server setup

Requires Python 3.10+, PHP with `proc_open` enabled, and permission for the web server to write to `public/uploads/stereo-depth`.

```bash
python3 -m venv .venv-stereo
.venv-stereo/bin/pip install torch torchvision pillow numpy
```

Configure the PHP/web-server environment variable `MINIVR_AI_PYTHON` to the absolute path of `.venv-stereo/bin/python`. If not set, the endpoint uses `python3`. The first run downloads pretrained **torchvision RAFT-Small** weights from the official PyTorch source; the server needs outbound internet access for that first run. Subsequent runs use the local Torch cache. Use CUDA-enabled PyTorch for faster generation; CPU inference can take a long time.

The model estimates *optical flow from both eyes*, then uses horizontal displacement as a relative stereo-depth proxy. This is a two-view neural model, **not** a calibrated metric-depth stereo network. It works best with rectified SBS/TB pairs; vertical misalignment, water, reflections, sky, and synthetic stereo can still yield incorrect depth. Output is confidence-masked, median-filtered, and blurred to avoid sharp spikes.

Click the AI button again to regenerate a map; on success the old map is removed. Failed generation leaves the previous map unchanged. The viewer automatically uses the stored PNG and falls back to the local depth estimator if it cannot load the map. Other stereo modes are unchanged.

**Operational note:** Generation runs synchronously as an authenticated PHP POST and may take minutes; ensure reverse proxy and PHP execution timeouts permit this. For high-traffic installations, move the worker into a background queue and restrict concurrency. Generated PNG files should be backed up with the SQLite database.

## Manual test

1. Upload an SBS image to a tour-scene image hotspot and save it.
2. Click **Создать карту глубины AI**; verify a grayscale preview appears and the PNG exists under `public/uploads/stereo-depth`.
3. Open the tour, click the hotspot and open **Живое 3D Pro**. The status text should say **карта глубины Stereo AI**.
4. Test strength 35% and 60%, then check legacy modes.
5. Click **Повторная AI-обработка** and verify a new preview is displayed.

No model weights are committed to Git.
