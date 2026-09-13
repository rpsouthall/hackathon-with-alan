# Kyoto City — final verification

**Result: SHIP WITH NOTES.** The corrected environment exports, render revision **kyoto-city-v2-depth-fix-20260913**, passed structural verification and a fresh movement/clearance run at **2026-09-13T04:52:16.348Z**. This verdict covers the environment assets and the supplied walking preview.

| Export | Loaded meshes | Triangles | Materials | File size |
| --- | ---: | ---: | ---: | ---: |
| kyoto_city.glb | 257 | 432,717 | 31 | 22.39 MB |
| kyoto_city_lod1.glb | 247 | 303,401 | 29 | 14.01 MB |

The measured footprint is **68 × 54 m**, or **3.0197×** the original 38 × 32 m area. Both exports remain below the **650,000-triangle** budget. The package contains **41 placement markers**, **294 collision boxes**, and **16 interior point-light records**. No external textures are required.

## Geometry and export checks

The [original source audit](qa_source.json), retained from before the surface correction, reports **10,402 editable visible mesh objects**, **432,717 evaluated triangles**, and **31 materials**. That baseline audit found zero non-finite vertices, zero-area faces, degenerate triangles, isolated vertices, wire edges, or edges shared by more than two faces. It did not detect the overlapping surfaces subsequently exposed by camera-motion review.

The remaining source notes are **129,211 open boundary edges on 1,202 objects**. These occur on intentionally open foliage, cloth, water and surface details. The render meshes are not claimed to be watertight; gameplay uses the separate closed box proxies.

[Full-export structural checks](qa_kyoto_city.json) and [LOD structural checks](qa_kyoto_city_lod1.json) both pass, including binary/accessor bounds, finite position data, index references, scene graph, transforms, and marker metadata. The independent Three.js loader agrees with the measured triangle and mesh counts. All **41 markers** preserve their positions and custom properties in both GLBs; both canopy groups preserve **COLOR_0** and enable vertex colors. No camera, light, collision proxy or presentation helper leaked into either render GLB.

## Surface correction

Stationary shop flicker came from exposed faces sharing the same depth. The corrected source makes corner posts **0.25 × 0.25 m**, lowers the visible floor substrate top to **0.29 m** beneath the **0.30 m** floorboards, and separates shelf boards from their uprights and backing. The floor collider remains at **0.30 m**. Collision and gameplay files are byte-identical to the original release; [RELEASE.json](RELEASE.json) records the corrected render hashes separately.

Regression tests against the actual runtime GLB now pass for all **16 venue side walls**, all **192 floorboard probes**, and the bakery display shelves. Independent comparison of both render exports confirms unchanged mesh/triangle counts, all marker transforms and properties, complete material definitions, world bounds, and cherry canopy colors. Run these checks from `../web` with `node --import tsx --test tests/world/city-depth.test.ts tests/world/city-asset.test.ts`.

## Movement and clearance

The [runtime report](qa_runtime.json) was generated using Three.js **r180**, Rapier **0.19.0**, and Node **v25.8.0**. It moves an actual kinematic capsule with **0.28 m radius**, **1.70 m total height**, **0.22 m autostep**, **0.30 m ground snap**, **0.015 m controller offset**, and **35° maximum climb slope** at **2.4 m/s**.

- **All 14 routes pass:** central guide/café/inn approaches, the original bridge in both directions, the north bridge in both directions, and entry → interior → conversation turn → exit for all eight venues.
- **All 208 doorway/interior capsule samples pass** against exported triangles, independently of authored box colliders. No furniture or doorway obstruction exceeded the 2.5 cm geometric tolerance.
- **All 15 NPC positions pass** physics support and visible-geometry occupancy checks: eight venue hosts, three central NPCs, and four market NPCs.
- Each interior turn reaches approximately **1.99 m** from its host, within the **2.8 m** interaction radius. Maximum route endpoint error is **5.16 cm**. Maximum measured physics penetration is **1.20 mm**, on the north bridge.

## Visual review and limitations

Browser interior views were visually inspected for **Kissa Aoi, Ramen Akari, Bookshop Tsuki, Sakura Bakery, Izakaya Tomo, Tea Hanami, Market Provisions, and Restaurant Momiji**, separately from the automated loader and physics checks. Final Japanese menu lettering was checked in the full export, and the shelf-mounted ramen menu was checked in the lighter export.

**Known ground limitation:** thin decorative paving lies above the simplified ground colliders. The maximum local capsule-foot overlap with that paving is **5.60 cm**. These low surface overlaps are recorded separately from walls and furniture. The maximum sampled visual foot gap is **8.29 cm** during bridge traversal/transitions; narrow plank-seam ray misses are separately retained in the JSON. A visible third-person avatar may need tighter floor collision or foot placement adjustment.

The automated routes sample specific paths and poses; they do not prove unrestricted navigation through every location. No GPU frame-rate or mobile-performance benchmark was performed. NPC animation, Japanese voice conversations and scoring are outside this environment verification.

Reproduce the export checks with `python3 scripts/verify_exports.py` from this folder. Reproduce the loader, collision and clearance checks with `node verify_three.mjs` from `preview/`.
