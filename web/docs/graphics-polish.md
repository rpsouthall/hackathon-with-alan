# Graphics polish

The runtime uses a local cutaway through scenery instead of switching whole
batched meshes between opaque and transparent. This preserves venue floors,
furniture outside the opening, neighbouring buildings, and the authored shadows.

- Three parallel rays match the isometric projection; perspective cameras use a
  ray from their camera position. Checks run at 20 Hz with a 240 ms hold through
  short misses. The opening eases on every rendered frame.
- A compact foliage opening grows to a 3 × 2.3 metre half-extent aperture at
  architecture. Roof, trim and wall materials in one venue open together. Group
  matching handles Blender `.001` and GLTFLoader's sanitised `001` suffixes.
- The analytic shader aperture uses MSAA alpha-to-coverage. It does not use
  random alpha hashing, transparency sorting, or per-frame material recompilation.
  Ground pixels below the traveller's feet plus 0.12 m are protected.
- Labels are projected after camera follow/controls update. Obstructed NPC labels
  are hidden; the label ray recognises the currently visible cutaway.
- A fixed warm sun, cool sky fill and existing venue lights form the lighting
  rig. A fitted world-space shadow frustum covers the complete city. Shadow maps
  use up to 4096 pixels per side, bounded by GPU texture capability, with modest
  bias and PCF filtering. This costs more shadow memory than the previous 2048 map.

`/world-lab` has eight venue-entry fixtures for repeatable doorway checks. Leave
the network URL blank to use those fixtures. Production app flow, room physics,
asset exports, voice and scoring are unchanged by this patch.

Verification: six graphics regression tests, including the actual city GLB's
roof/trim grouping, orthographic/perspective rays, hold/recovery and shadow
coverage. The inherited 44 world tests also pass. Browser checks covered spawn
canopy visibility and bakery/café entry, exit, zoom and town overview. These are
targeted checks, not a claim of exhaustive GPU/device or every-camera-angle QA.

When rebuilding a running Wrangler production preview, restart the preview
afterwards: its old static asset index can otherwise return an empty 200 GLB
response. This is a local preview issue; asset hashes remain unchanged.
