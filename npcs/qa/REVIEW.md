# Delivery review

**Verdict: SHIP WITH NOTES.** Reviewed in Blender 5.2.1 LTS and Three.js r180; source/asset compatibility suite also passes in Three.js r186 from the consolidated game's installation.

The deliverable is an NPC asset/runtime kit and character workshop. It does not yet include the larger game's navigation, physics, environmental camera obstruction or voice service.

## Checks

- Thirteen automated tests pass against the actual exported GLB in both Three.js revisions, covering skeletons, morph targets, material/animation isolation, scale, loop seams, floor contact, gesture transitions, patrol movement and exported Kyoto markers.
- The 15-member city catalog covers every authored resident/vendor marker, with unique identities and correct world positions. Venue hosts face their visitor interaction markers. All 72 player part combinations (3 hairstyles × 3 outfits × 2 glasses × 2 bags × 2 height limits) select exactly one hairstyle/outfit, remain grounded and render at most 1,200 triangles.
- The expanded cast was visually inspected in its browser gallery, including locomotion across all residents, with no browser console warnings/errors.
- Four GLB files pass the Khronos validator with zero errors. The expected `NODE_SKINNED_MESH_NON_ROOT` warnings remain documented in `runtime.json`; each character's mesh and bones share its parent hierarchy.
- All three selected-look exports load back into Three.js with the requested height and seven clips. Animated voice, shin and hand socket positions match the source at sampled points in every clip, with zero measured difference.
- Walk and run were sampled at 120 times per cycle. Maximum foot penetration was less than 0.7 mm; the stance foot stays on the ground. Motion is in place, with velocity-driven playback in the runtime.
- The complete kit contains 1,606 triangles. Default presets render 696–902 triangles and 12–15 material primitives each. These figures exclude shadows, the workshop scenery, and unselected parts.
- All presets were re-imported into Blender to produce `residents.png` and `silhouettes.png`. The latter checks a frontal guide, rear café owner and side inn host. The master portrait is `blender-hero.png`.
- Browser checks: resident selection, hair/outfit changes, colour changes, glasses/day-bag toggles, animation preview, third-person camera and keyboard movement, independent cast patrols, save/load appearance JSON, reset, and animated GLB download. Browser console had no warnings or errors during those checks.

## Defects corrected during review

- Reset newly created facial shape-key weights to zero so the asset loads with open eyes and a closed mouth.
- Covered the sleeve tops and separated the clothing/head surfaces at collar and hairline to eliminate coplanar surface artifacts in Blender renders.
- Matched the authored loop endpoints to exact 30 fps durations.
- Prevented the finish event from a fading gesture from cancelling a newer locomotion animation.
- Reframed the default cast camera to keep the foreground trees from hiding a resident.

## Integration notes

- Use the full kit with `VoxelNPC`; use a preset GLB for direct `GLTFLoader` rendering. The kit contains mutually exclusive parts that the runtime selects.
- Supply resolved foot positions/velocity from the game's physics layer. `NPCPatrol` follows authored points and is not a navigation solver. The workshop has only flat, conservative obstacle tests.
- This is a small-cast rig. Each resident has its own skeleton/mixer and material copies; crowd instancing and LODs are not implemented.
- Voxel parts use rigid weights, not smooth skinning. Mouth movement is an envelope input for future speech, not phoneme synchronization. The Talk preview uses a synthetic envelope.
- The supplied scene is a palette/style reference. The characters intentionally keep voxel silhouettes while matching its matte slate, sage, coral, ochre and cream colours.
