# Shop-entry visual review

Reviewed 13 September 2026 against the integrated city preview on port 5182.

## Findings and ownership

| Finding | Evidence | Resolution owner |
| --- | --- | --- |
| The wrong building fades while the traveller remains hidden. | Between Sakura Bakery and Izakaya Tomo, the bakery roof disappears while the traveller is behind the neighbouring shop. The baseline casts from the camera position despite using orthographic projection. | Graphics agent: parallel view rays through the traveller. |
| Roofs and walls pop or flicker at obstruction boundaries. | Baseline renderer switches opacity between 0.12 and the original value each frame using a single ray, with no transition or hold. | Graphics agent: multiple rays, a short hold, smooth local cutaway. |
| Fading a wall can also erase unrelated interior details. | Exporter batches by collection and material, combining floors, framing and furniture. | Graphics agent: local cutaway with floor protection; environment agent reviewing export grouping. |
| Labels drift during camera following and show through opaque buildings. | Baseline projects labels before camera following; indoor NPC labels are visible on opaque exterior walls. | Graphics agent: project after camera update and suppress occluded NPC labels. |

## Repeatable review

Open `/world-lab`, leave the WebSocket server blank, and select a venue under **Shop entry review**. Each fixture uses the real city geometry, authoritative local collision controller and resident positions, with the traveller placed at the exported entry marker. The main game spawn and multiplayer rooms are unchanged.

For each of the eight venues:

1. Walk through the doorway, stop inside, and return outside.
2. Reverse direction at the threshold several times: no popping or flashing.
3. Orbit to the opposite side: reveal the actual obstruction, without hiding another building.
4. Check that the traveller remains readable and floors, counters and furniture remain intact.
5. Pause until the cutaway settles; walk away and confirm the exterior restores smoothly.
6. Check labels remain attached to their characters and do not float on opaque walls.
7. Enter and exit overview mode and check the cutaway restores.

Existing physics tests cover all eight venue entry/interaction/exit routes. Visual review is separate from those collision checks.

## Verification results

- Shared workspace TypeScript check: passed.
- Physics suite: 23 tests passed, including all eight shop entry/interaction/exit routes.
- First graphics preview (port 5186): Bakery and Kissa Aoi checked from opposite-facing entrances; neighbouring buildings and floors remained intact, and overview restored the exterior. No shader errors; existing Rapier initialization deprecation warning only.
- Follow-up requested: enlarge architectural cutaways; the initial avatar-sized opening was too small to read the interior. Graphics owner is implementing smooth expansion to 3 × 2.3 m radii while retaining compact tree clearance.

- Expanded-opening preview: Bakery interior/exit checked at normal and closer zoom; Market Provisions checked on the perpendicular street. Shop furnishings and adjacent buildings remain intact.
- Found and reported a real-asset grouping bug: GLTFLoader changes `.001` to `001` in mesh names. Graphics owner corrected the grouping and added a test using the actual city GLB. Independently ran all six graphics regression tests successfully.
- Preview rebuild briefly served a zero-byte GLB with HTTP 200. Restarting the static preview server restored the full 14,014,860-byte model.

## Final graphics review

Graphics commit `747eb10c5fe2b8fe9c80453c449b76e4cfedac32` passed the final bakery visual check on port 5186. The roof, trim and wall now open together; traveller, shopkeeper, floor and counter remain visible. Browser console reported no errors. Review approval was sent to the graphics and camera integration agents. Main-game camera integration is owned by the camera agent.

## Follow-up: stationary flicker in user recording

User recording `Screen Recording 2026-09-13 at 12.33.21.mov` (1.343 s) exposes dark triangular depth conflicts on bakery and neighbouring venue plaster walls, plus interior floor/counter regions. The cutaway opening stays stable. Prior visual checks did not catch these coplanar surfaces.

Source evidence in `kyoto_city/scripts/venues.py`:

- Side walls: center ±3.52, thickness 0.16 → outside faces ±3.60. Corner posts: center ±3.50, width 0.20 → exactly the same outside faces ±3.60.
- Floor slab: center 0.215, height 0.17 → top 0.300. Floorboards: center 0.286, height 0.028 → the same top 0.300.

These ties can produce changing triangular fragments as the camera settles. Graphics and environment owners notified with exact dimensions and decoded video frames.

### Follow-up regression evidence

Added `tests/world/city-depth.test.ts` against actual exported triangles: both side walls of all eight shops, 24 floorboards per shop, and bakery display shelves. The probes compare outward-facing rendered surfaces; buried reverse faces are excluded because touching undersides are legitimate solid geometry, not the visible depth conflict. All three tests fail on the original release and pass on the corrected isolated export. Final browser verification remains required.

### Corrected-model visual check

Corrected LOD SHA-256: `9a81fc6fe459477544be3091b4a3f55023439fd9d5823d7285d23e6d07040169`. Confirmed the preview served that exact 14,014,860-byte model. Recreated the zoomed bakery interior, then moved slightly backward and forward and inspected the settling camera view. Bakery and neighbouring shop posts remained continuous, with none of the dark triangular patches observed in the recording. Floor and shelf surfaces stayed stable. Browser console reported no errors. Approval sent to the graphics owner for narrow main integration.
