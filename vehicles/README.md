# Kyoto vehicles

Original stylized scooter and skateboard, authored in Blender 5.2 through MCP for the Kyoto conversation game. Metres, ground origin, GLB Y-up and +Z forward. No downloaded models, external textures or branded assets.

- `vehicles.blend`: editable Scooter/Skateboard asset scene plus a separate studio presentation scene.
- `scripts/build_vehicles.py`: reproducible geometry, materials, sockets, export and studio render. Execute inside Blender; `build()` exports, `render()` makes the beauty image.
- `exports/`: engine GLBs, copied to `web/public/models/vehicles/`.
- `renders/vehicles_hero.png`: actual Blender render.
- `QA.json`: measured bounds, geometry counts, pivots and source sockets (socket values in Blender Z-up coordinates).

Scooter: 9,196 triangles, about 255 KB, 0.705 m wide × 1.761 m long × 1.398 m tall. Seat top 0.832 m, grips at [±0.28, 1.12, 0.5], feet at [±0.15, 0.308, 0.05]. `Wheel_Front` and `Wheel_Rear` spin about local X; radius 0.22 m. Separate `Stand` hides while mounted.

Skateboard: 2,052 triangles, about 87 KB, 0.314 m across wheels × 0.85 m long. Deck top 0.137 m, raised tips. Four named wheel pivots, radius 0.045 m. The grip and wooden deck use matching cross-section geometry to avoid nonplanar polygon overlap.

Production budgets: scooter under 12,000 triangles, board under 4,000; shared opaque PBR materials. Runtime uses one loaded template per type, shared immutable geometry across three instances of each, separate wheel animation and a reversible procedural riding pose on the existing avatar skeleton. Assets are authored independently from the city Blender source.
