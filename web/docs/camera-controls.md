# Camera controls

The game starts in isometric view. Use **Third person** at the upper right, or press **V** while the world is focused, to switch views. The transition takes 0.75 seconds and keeps the player centered. The reduced-motion browser preference changes views immediately.

- **Third person:** drag with either mouse button to orbit a full 360 degrees and tilt; scroll to zoom. One-finger drag rotates; two-finger gestures rotate and zoom. Vertical movement stops above the ground.
- **Isometric:** right-drag rotates around the player at a fixed isometric elevation; scroll to zoom.
- **View town / Follow player:** moves to the town overview and returns to the previously chosen view, preserving its rotation, tilt and zoom.
- **WASD / arrow keys:** walk relative to the current camera. Camera buttons return focus to the world. Input pauses during view transitions and while dialogs are open.

`lib/world/camera-rig.ts` owns the orthographic, perspective and intermediate camera poses. It blends both position and projection, then hands control to a real Three.js orthographic or perspective camera. `scene.ts` passes the interpolated player position to the rig and uses its active camera for rendering, movement directions, picking, cutaways and labels. It does not modify authoritative positions or the multiplayer protocol.

Regression checks in `tests/world/camera.test.ts` cover projection continuity and depth, complete horizontal rotation, elevation constraints, saved overview return, tracking a moved player, resizing and rapid reversals, reduced motion, and input isolation.
