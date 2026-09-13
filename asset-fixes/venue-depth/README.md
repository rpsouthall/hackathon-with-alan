# Venue depth repair

The recording exposed coplanar timber/plaster faces and floor/support layers in
`kyoto-city-v2-final-20260913`. A ray audit of the shipped GLB reproduced the ties.

The corrected render export keeps the gameplay revision, collision data, markers,
materials and triangle counts unchanged. `RELEASE.json.render_revision` identifies
the new geometry. LOD1 remains 303,401 triangles and 14,014,860 bytes.

Visual-only source changes across eight venues:
- Corner posts are .25 m wide instead of .20 m, clearing wall faces by .025 m.
- The supporting floor top is .290 m; boards and authoritative floor stay .300 m.
- Shelf posts gain .04 m in depth; boards inset .20 m in width and .09 m in depth.

`venues.patch` updates the generator. `fix_depth.py` migrates an existing original
Kyoto_City scene without regenerating objects or modifying shared mesh data. Run
it with Blender against an isolated source copy. Place the existing export_city.py
beside the migration script and create the exports directory in its parent. The
script saves the corrected blend and both render GLBs there; it refuses repeat
migration. Keep collision/gameplay exports from the original release.

The actual-GLB tests check all 16 side walls, 192 board probes and the bakery shelf
faces. Only surfaces facing the probe count: buried reverse faces do not cause
visible depth competition. All three fail the original export and pass the fix.
