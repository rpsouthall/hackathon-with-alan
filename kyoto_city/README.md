# Komorebi — Kyoto City

An original Kyoto-inspired environment for a Japanese conversation game. Version 2 expands the preserved [riverside base](../kyoto/README.md) to **68 × 54 m**, or **3.02 times** its 38 × 32 m ground area.

The city includes the central pagoda and machiya district, two canal bridges, connected streets, eight furnished venues with open entrances and Japanese menu boards, four market carts, cherry gardens, bamboo, lanterns, and seating. It uses original procedural geometry and materials; no Sketchfab model data or third-party textures are embedded.

Final full export: **432,717 triangles / 257 meshes**. Lighter export: **303,401 triangles / 247 meshes**. Both retain 41 named placement markers. Gameplay data includes 294 box proxies and 16 interior lights.

## Open the city

- `kyoto_city.blend` — editable source. Select the `Kyoto_City` scene. Venue geometry is grouped under `COL_Venue_<id>`.
- `exports/kyoto_city.glb` — full render geometry, materials, vertex colors, and named markers.
- `exports/kyoto_city_lod1.glb` — lighter alternative. Load one detail level at a time.
- `exports/kyoto_city_collision.glb` — collision geometry for inspection.
- `exports/kyoto_city_gameplay.json` — box collider transforms, markers, player dimensions, and interior point lights.
- `venues.json` — each venue’s layout, dimensions, furnishing theme, and interaction points in Blender coordinates.
- `renders/` — Blender overview and interior images.

## Enterable venues

| Place | Interior |
| --- | --- |
| Kissa Aoi | Espresso counter, pastry display, café tables |
| Ramen Akari | Ramen bar, stools, cooking range, bowls |
| Bookshop Tsuki | Bookshelves, display stacks, reading desk |
| Sakura Bakery | Bread displays, pastry table, oven |
| Izakaya Tomo | Sake bar, dining table, benches, dishes |
| Tea Hanami | Tatami platform, low tables, tea service |
| Market Provisions | Produce displays, jars, rice storage |
| Restaurant Momiji | Dining tables, place settings, kitchen counter |

All eight new venues have accessible ground floors. Entrances remain open; there is no door animation. The upper residential storeys on the bookshop and izakaya are decorative. The three original central shop/inn buildings retain their exterior-only construction.

NPCs, dialogue, voice integration, scoring, and autonomous navigation are future game features. Named markers reserve their positions and conversation spaces.

## Local walking preview

From `kyoto_city/preview`, install the pinned dependencies:

```sh
npm ci
```

Then from `kyoto_city`, serve the folder:

```sh
python3 -m http.server 8766 --bind 127.0.0.1
```

Open [the local preview](http://127.0.0.1:8766/preview/). Use **Walk**, then **WASD** to move, **Shift** to run, drag to look, and **Q/E** to turn. **Esc** returns to the city view. The venue selector places you outside a doorway, facing into the shop; **Inside** jumps to its interior review point. The preview requires a desktop keyboard and WebGL; it is an environment review tool.

## Three.js / Rapier integration

Blender uses metres with Z up. The GLB and gameplay JSON use metres with Y up: `(x, y, z)` becomes `(x, z, -y)`. The GLB is already converted; do not rotate or rescale it again. The detailed `venues.json` remains in Blender coordinates.

Instantiate gameplay JSON boxes with their `position`, quaternion `[x,y,z,w]`, and `halfExtents`. Do not create physics from all decorative triangles. For Rapier, the player capsule uses radius **0.28 m** and segment half-height **0.57 m**, giving **1.70 m** overall height. The supplied preview uses 0.22 m autostep, 0.30 m ground snap, 0.015 m controller offset, and a 35° climb limit. Marker positions refer to feet.

Each new venue has `MARK_entry_<id>`, `MARK_inside_<id>`, `MARK_interaction_<id>`, and `MARK_npc_<id>` nodes. Their custom properties include `venue_id`, `display_name`, and an interaction radius. Read these with Three.js `Object3D.userData` or use the JSON. Venue conversation radius is 2.8 m. Future NPC capsules can occupy the reserved NPC points without blocking the central aisle.

The GLBs contain no cameras or lights. Recreate scene lighting in the runtime. Interior point lights are supplied in the gameplay JSON; their Three.js intensity is an art choice rather than an exact Blender watt conversion. Water and plants are static. Materials use flat colors and vertex colors, so there are no missing external texture files. Preserve `COLOR_0` when recompressing the GLBs.

## Verification and authoring

Current measurements and test results are recorded in `QA.md`, `qa_source.json`, `qa_kyoto_city.json`, `qa_kyoto_city_lod1.json`, and `qa_runtime.json`. All 14 route tests, 208 doorway/interior clearance samples, and 15 NPC standing positions pass. The remaining integration note is up to 5.6 cm of visible paving above simplified ground collision; account for this when placing animated feet. Geometry budgets are 650,000 triangles for the complete city. This is a desktop hackathon target, not a measured mobile performance guarantee.

Run structural export checks with `python3 scripts/verify_exports.py`. Run the actual Three.js loader and Rapier route checks with `node verify_three.mjs` from `preview/`. The runtime test checks both bridges, entry and exit for all eight venues, NPC standing clearance, and exported mesh clearance through doorways.

The original base source is preserved at `../kyoto/kyoto_komorebi.blend`. The generation phases are in `scripts/city_ground.py` and `scripts/venues.py`, using the shared helper functions in `../kyoto/scripts/core.py`. They were executed through Blender MCP against a copy of that base. Treat the saved city `.blend` as the editable source; do not rerun the venue generator on an already-built scene because it would duplicate objects. Export with `scripts/export_city.py` after source cleanup and validation.
