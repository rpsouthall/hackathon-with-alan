# Komorebi residents

Original voxel NPC kit for the Kyoto Japanese conversation game. Third-person browser target, authored in Blender and delivered as GLB for Three.js r180.

- Grid: 0.025 m. Flat, stepped silhouettes with no bevels or external textures.
- Height: approximately 1.75 m, feet at origin. Blender Z up / -Y forward; GLB Y up / +Z forward.
- Budget: fewer than 5,000 triangles for the entire kit including mutually exclusive parts, no textures, at most 16 visible material primitives per character. This is a small-cast asset, not an instanced crowd system.
- Rig: rigidly weighted voxel limbs, articulated shoulders, elbows, hips, knees, ankles, head and jaw. Named attachment sockets. One influence per vertex is intentional for block characters.
- Clips: idle, walk, run, wave, bow, talk, listen. Locomotion in place. Feet use an analytical two-link solution during animation authoring; baked FK curves travel in GLB.
- Customization: skin/hair/clothing/accent/trouser/shoe colours; cropped/bob/topknot hair; jacket/apron/haori; glasses; bag; height.
- Presets: local guide, café owner, inn host. Role IDs match existing Kyoto markers.
- Source regeneration: standalone background Blender process, separate from the open environment scene. Only `npcs/` is edited.
- Pipeline: voxel blockout → surface merging → palette and rigid rig → animation → source audit → GLB export → Three.js import, animation and customization checks → browser visual review.
- Skills: Blender Director, Voxel Style, Rigging, Animation, Asset Optimization, Export Pipeline, QA Review. The installed shared `../references` pipeline files are absent; use the explicit workflows in the installed skills and retain this brief as the task specification.
