# Stereo 3D Pro: fragment-shader parallax

The old 3D Pro displaced a 160×100 Three.js plane mesh along Z. At sharp depth transitions this caused stretched diagonal triangles (especially tree silhouettes and clouds). Smoothing the depth PNG did not fully solve the artifacts.

This change uses an **undisplaced, flat plane** with a fragment shader. Each fragment samples the existing depth map and offsets its source-image UV using the mouse position, the existing 0–100% strength control, and a three-step depth lookup. The geometry has no Z spikes, so the distinctive triangular mesh tearing cannot occur. The shader clamps UVs at the image boundary and keeps the 75% pointer damping. The existing browser AI/stereo map generation, PHP upload and other fullscreen modes are unchanged.

**Limitations:** this is depth-image-based parallax, not a fully reconstructed 3D scene. At object boundaries, a single image cannot reveal hidden background pixels; the UV warp may show mild smearing/ghosting, but it should no longer show giant triangles. Test with the reported sunset/tree/cloud stereo image at 52% and 100% strength and with both SBS and TB. Verify smooth mouse movement, zoom/aspect and WebGL support before merging. This change has not been tested in a browser yet.
