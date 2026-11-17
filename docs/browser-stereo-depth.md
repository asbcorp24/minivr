# Browser Stereo AI depth for hotspot images

The hotspot admin page now has **Создать карту глубины AI / Пересоздать карту AI** for locally uploaded SBS and TB photo hotspots.

This deliberately reuses the existing browser-only `@huggingface/transformers@3.7.6` and `onnx-community/depth-anything-v2-small` setup from `public/assets/depth-generator.js`: WebGPU first, WASM fallback, browser model cache, PNG upload via authenticated PHP. **No Python or PyTorch on the server.**

The browser splits the pair, runs the same monocular depth network **on both eyes**, normalizes the two maps and blends them with an agreement weight. This is **not** calibrated stereo disparity or a dedicated two-view stereo network; it is a first practical browser-only approximation. The image should be reasonably aligned; reflective surfaces and occlusions can remain unreliable. For a true stereo model a separate ONNX two-view model would be required.

The resulting grayscale PNG (white near, black far) is uploaded to `public/admin/stereo-depth-upload.php`, stored under `public/uploads/depth/h<ID>-<random>.png` and linked from the new `hotspots.depth_map` SQLite field. Reprocessing replaces the path and removes the prior generated map after success. The fullscreen 3D Pro mode loads this prepared map and falls back to the previous local estimator if the map is unavailable. Other stereo modes are unchanged.

Manual checks: create an SBS and a TB hotspot; generate and preview the map; open 3D Pro and check the saved-map status; reprocess; try WebGPU-disabled WASM; verify an unauthenticated POST is rejected; test the existing wiggle/anaglyph/pair modes. Browser inference has not yet been tested on the deployment server.
