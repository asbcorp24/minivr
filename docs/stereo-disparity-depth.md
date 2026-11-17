# Stereo depth: disparity + neural estimate

The admin SBS/TB generator now uses the **existing browser Depth Anything V2** pipeline and additionally measures signed horizontal displacement between the left and right eyes. The new `stereo-disparity.js` runs a low-resolution SAD block matcher with texture and uniqueness confidence checks. Its normalized disparity is blended into the neural relative-depth map only in reliable regions. The UI previews AI, stereo displacement and the final map, and has a 0–100% distant-depth boost control (default 35%). The saved grayscale PNG and Three.js 3D Pro loading path remain unchanged.

**Limitations:** this is browser block matching, not a dedicated neural stereo model. Input pairs must be horizontally rectified. Actual clouds at infinity often have negligible disparity; flat, repeating or moving cloud patterns are inherently ambiguous and intentionally receive low matching confidence. The boost adjusts visibility, not physical distance. Test on a known stereo pair and compare all three preview maps before judging geometry.

## Manual verification
- Generate on SBS and TB hotspot photos and check all three previews, then reopen 3D Pro.
- Confirm changes with the distant-depth slider by regenerating; test 0 and 100.
- Check a sky-heavy photo: unreliable sky must not produce large triangular spikes.
- Check a close object with visible stereo separation: the disparity preview should contain a coherent brighter region.
- Test WebGPU and WASM fallback; existing wiggle/anaglyph/pair modes must still work.
