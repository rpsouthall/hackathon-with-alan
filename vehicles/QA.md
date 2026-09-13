# Vehicle implementation verification · 13 September 2026

**PASS** — Three scooters and three skateboards are available in the shared Kyoto room. Both types mount, ride and dismount through authoritative commands. No city geometry was replaced.

## Asset checks

Original Blender source saved at `vehicles.blend`. GLBs parse with the actual Three.js loader; finite geometry, metre scale, ground origins, +Z forward, two/four independent wheel pivots, named sockets. Scooter 9,196 triangles / 255,000 bytes; skateboard 2,052 triangles / 87,452 bytes. Both below their production budgets. Studio render inspected; the board's nonplanar deck was rebuilt with cross sections before final export.

## Runtime checks

- 128 full world tests passed, including eight vehicle authority/physics tests and real WebSocket ownership/movement/late-join/disconnect coverage.
- Two additional actual-asset and riding-pose tests passed. Scooter hand sockets meet grips across 1.5, 1.7 and 1.9 metre avatars; skateboard feet form the sideways stance; dismount restores authored rig transforms.
- All six real parking locations can mount/dismount against the 294 exported city colliders. Walls block riding; unsupported ledges stop riders without falling or teleporting. Distant and through-wall mounts reject. One player owns each vehicle; disconnect releases it.
- TypeScript and targeted ESLint passed. Isolated production build completed successfully.
- Browser: scooter mount/seated pose, skateboard mount/sideways pose, both camera views, F dismount, and re-enabled emote controls inspected. No browser console errors. Movement physics and multiplayer synchronization verified by automated authority/WebSocket tests; browser key taps are not a sustained handling/performance benchmark.

## Preview

Finished production preview: http://127.0.0.1:5197/
Matching normal-spawn world server: ws://127.0.0.1:8796/world
Isolated built files: `/private/tmp/kyoto-vehicles-preview` (main source remains in `web/`). Older preview processes were left running. Temporary browser QA used a skateboard-adjacent spawn; the delivered server was restarted with the normal Kyoto spawn.

Current scope is shared ground riding. Vehicles stay where riders leave them during a room's lifetime; rooms remain in memory. This is not a rigid-body stunt simulation or persistent vehicle inventory.
