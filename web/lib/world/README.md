# Consolidated world integration

The game renders the final Kyoto City v2 environment and all 15 residents in Three.js. A shared character editor creates each player's traveller. Rapier resolves player movement against the exported city collision boxes; local solo play and the multiplayer server use the same `WorldRoom` implementation. The runtime uses protocol 3 and includes sprint, emotes, six shared vehicles and a synchronized day/night clock with optional personal lighting. Hosted rooms include player proximity voice. Japanese NPC conversations and feedback remain labelled samples; NPC audio, GPT/HeyGen sessions, lessons and real assessment are not connected.

## Run and play

From `web/`, with Node.js 22.13 or newer:

```sh
npm ci
npm run dev:game
```

Open **http://localhost:5173**. The welcome screen lets you choose a name, room and appearance, with a live 3D preview. **Join Kyoto** connects to the local room server; **Play solo** opens a private copy of the city. For multiplayer verification, use two tabs with different names and the same room name.

| Control | Action |
| --- | --- |
| Click the world, then WASD / arrows | Walk relative to the camera |
| Shift + movement / G | Sprint / emote wheel |
| F near a vehicle / while riding | Mount / dismount; ownership and placement are authoritative |
| V / on-screen arrows | Change camera view / short movement steps |
| Right-drag / scroll | Orbit / zoom |
| E near a resident, their label, or Start encounter | Request a conversation; distance is checked by the authority |
| Join encounter | Join a nearby resident's existing group |
| Claim / release speaking turn | Select the group's one permitted future NPC speaker; NPC audio remains unavailable |
| T / player voice controls | Opted-in hosted player push-to-talk; unavailable in solo/direct Node development |
| Escape / Finish | Leave your encounter membership |
| Character / Room | Change your shared appearance / connection |
| View town / Follow player | Switch between overview and walking views |

`GAME_PORT=5183 WORLD_PORT=8789 npm run dev:game` changes both ports and configures the matching browser Origin allowlist. The launcher runs both services on loopback and stops them together. It does not publish a server or make it available to other computers.

The direct Node development transport provides gameplay only; voice controls stay unavailable there and in solo mode. For the signed hosted path, including local Durable Object testing, use [the hosted-room guide](../../multiplayer/README.md). On public domains the default is `createHostedTransport()`, which obtains a short-lived Site ticket; configure `WORLD_SERVER_URL` and `WORLD_TICKET_SECRET` as runtime values, not public build variables.

For separate local gameplay processes, run `npm run dev` and `npm run dev:world`. Set `WORLD_ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins when their ports differ. `WORLD_PORT` defaults to `8788`. The standalone main page defaults to `ws://127.0.0.1:8788/world` on localhost; set the public `VITE_WORLD_SERVER_URL` at frontend build/dev startup to supply another `ws://` or `wss://` room endpoint. That value is visible to browsers and must contain no secret. `dev:game` always wires its own local endpoint.

## Included assets and provenance

The authored city release is **`kyoto-city-v2-final-20260913`**; the current gameplay manifest is **`kyoto-city-v3-vehicles-20260913`**, with a 68 × 54 m footprint, two bridges, eight enterable furnished venues, 41 placement markers, 294 rotated collision boxes and 16 interior lights. The game loads the lighter city GLB and six parked vehicles (three scooters and three skateboards). The original three central buildings remain exterior-only; the eight newer venues have accessible ground floors. Upper residential floors are decorative.

Authoring sources live in the main checkout's **`kyoto_city/`**, **`npcs/`** and **`vehicles/`** folders (`/Users/ryansouthall/Documents/ChatGPT/Hackathon with Alan` on the authoring machine). The consolidated worktree contains the runtime exports, not copies of every Blender source or authoring preview.

| Consolidated file | Source |
| --- | --- |
| `public/models/kyoto/kyoto_city_lod1.glb` | `kyoto_city/exports/kyoto_city_lod1.glb` |
| `lib/world/data/kyoto-city-gameplay.json` | `kyoto_city/exports/kyoto_city_gameplay.json` |
| `public/models/kyoto/RELEASE.json` | `kyoto_city/RELEASE.json` |
| `public/models/characters/komorebi_npc.glb` | `npcs/exports/komorebi_npc.glb` |
| `lib/characters/presets.ts` | The 15 identities/appearances from `npcs/exports/kyoto_city_cast.json`, adapted to the shared schema |
| `public/models/vehicles/{scooter,skateboard}.glb` | Matching `vehicles/exports/` assets |

The copied city GLB and gameplay data match the SHA-256 entries in [RELEASE.json](../../public/models/kyoto/RELEASE.json) (the source lists the full-detail export too; this game uses LOD1):

```text
kyoto_city_lod1.glb       9a81fc6fe459477544be3091b4a3f55023439fd9d5823d7285d23e6d07040169
kyoto-city-gameplay.json fcf0eb34ccadbab6422c54c4faec0e7a23439320f35fe778b99ab93ae2c764ac
komorebi_npc.glb         45bb1fdbe87b4a7f21c0260a66a356465fa77f941c172cb03422e22bb761e232
```

The NPC hash records the matching source export; it is not an entry in the city's release manifest. The city and character geometry are original assets from these authoring threads. The earlier Sketchfab reference is not embedded in the game.

## Runtime contracts

- **`kyoto.ts`** builds the city manifest and all 15 NPC descriptors from the final gameplay export and shared cast presets. Stable marker IDs connect appearance, position, venue and conversation presentation. `npcSpawns` overrides descriptor positions; venue hosts face their authored interaction points.
- **`WorldProvider` / `useWorld`** expose the room snapshot, local player ID, connection status, errors and command sender. Supply a memoized `createLocalTransport({ environment: KYOTO_ENVIRONMENT, npcs: KYOTO_NPCS })` for solo city play, `createHostedTransport()` for signed hosted rooms, or `createWebSocketTransport(url)` for direct development rooms. Player voice has a separate validated channel and an explicit transport capability. The provider's unconfigured default remains the small blockout.
- **`WorldViewport` / `scene.ts`** render and interpolate authoritative positions. They load Three.js after mounting, show labels and selection rings, animate independent character instances, follow the player and fade obstructing scenery. They send movement directions and interaction requests, never authoritative positions.
- **`WorldRoom` / `physics.ts`** own movement, collision, players and encounters. `initWorldPhysics()` must finish before constructing a room whose manifest has `physics`; local transport and server startup already handle that requirement. Empty rooms and unmounted local sessions dispose their Rapier worlds.
- **`schema.ts` / `store.ts`** validate commands and state. The authority assigns player IDs. The store assigns monotonic movement sequence numbers, ignores stale/cross-room updates and clears identity/state on disconnect.

The multiplayer server sends the full environment once in `welcome`. Subsequent `state` messages contain players, NPCs, encounters, vehicles and the environment revision, omitting the large static physics/lighting manifest. The hosted Worker coalesces movement, encounter and appearance changes at the 20 Hz room tick. The local development server and solo transport retain their own immediate command updates. The store combines matching state with the accepted welcome environment. A changed environment revision requires a new welcome/rejoin. Local transport also uses compact state; full snapshots remain supported for compatibility.

An interaction becomes active only after the authority grants encounter membership. Selecting a portrait does not reserve an NPC. One encounter can contain multiple nearby learners; one participant can claim the speaking turn. Leaving or disconnecting removes only that learner, transfers encounter ownership as needed, clears a departing speaker and frees the NPC when the last learner leaves. Players stop walking during an encounter.

## Characters and customization

`lib/characters/avatar.ts` loads the shared customization GLB, clones its skeleton per actor and isolates materials, animation mixers and facial morphs. `presets.ts` provides all 15 residents. Each player supplies a validated `appearance` containing hairstyle, outfit, glasses, bag, height and six color channels. `set-appearance` changes only the connected player's cosmetics; identities and positions are not part of that command.

The welcome editor and in-game editor use this same runtime. Saved cosmetics are stored locally only after the authority accepts them, then sent again when a fresh guest joins. Other players see the accepted values. Local storage does not grant identity or room membership.

The visual height range is **1.4–2.1 m**. On foot, every player uses the same **1.7 m tall, 0.28 m radius physics capsule**, regardless of appearance. Riding uses a server-selected vehicle collision profile. Visible arms/clothing can extend beyond that capsule. The shared GLB supplies seven clips—Idle, Walk, Run, Wave, Bow, Talk and Listen—plus independent Blink and MouthOpen morphs. Cheer and Nod are generated from the existing rig. Actual player audio activity drives the Talk animation and speaking indicators while preserving movement, riding and emotes; NPC voice audio is not connected. Residents remain at their authored locations; autonomous multiplayer patrol/pathfinding is not implemented.

The active renderer uses the shared `komorebi_npc.glb` customization template for the cast and players. Replacing it with a different rig needs an adapter for its part metadata, material channels, skeleton and clip names. Setting a descriptor's `avatarUrl` alone does not configure another character rig in this renderer.

## Replace or extend the Blender world

1. Export an ordinary, uncompressed **glTF 2.0 binary (`.glb`)** and gameplay data together. Exported coordinates are **metres, Y-up**, with player/NPC positions at their feet. The existing exports are already converted from Blender's Z-up coordinates; do not rotate or rescale them again. Preserve vertex colors used by trees and other materials.
2. Put the GLB under `public/models/` or use a versioned HTTPS asset URL with suitable CORS. Update the server-owned manifest in `kyoto.ts`, including its `assetUrl`, `revision`, `spawn`, `bounds`, `npcSpawns`, lights and collision data. Restart/rejoin rooms so every client receives the same revision. Exported GLB markers alone do not change multiplayer authority.
3. Supply rotated boxes as `physics.colliders: [{ name?, position: [x,y,z], halfExtents: [hx,hy,hz], quaternion: [x,y,z,w] }]`. The current controller uses gravity −9.81 m/s², a 0.22 m autostep, a 35° slope limit and 0.30 m ground snap. Physics advances at fixed 1/60 s substeps; movement speed and maximum elapsed time are controlled by the authority. Falling below bounds respawns the player.
4. Retain stable NPC IDs and unobstructed interaction positions. The 15 city identities consist of `cafe_owner`, `local_guide`, `inn_host`, four `market_*` vendors and eight venue `_host` IDs listed in `RELEASE.json`. Add matching descriptors and appearance/presentation entries for new residents.
5. Keep NPC meshes separate from static scenery. `MARK_*`, `SM_COL_*`, `SPAWN_*` and `COLLIDER_*` helpers are hidden by the renderer. Use the exported collider data for gameplay instead of collision tests against every decorative triangle.
6. Re-run the route and loader checks, then inspect the loaded world in a browser. New terrain must be tested with the actual authority; a successful GLB load does not establish that a route is walkable. Draco/KTX2 compression needs explicit decoder configuration before using those assets.

Bridge slopes and authored stairs are supported and tested. Jumping, moving platforms, player-to-player collision, NPC pathfinding and line-of-sight conversation checks are not implemented. A manifest without `physics` uses the original flat-floor/AABB controller in `defaults.ts`; `/world-lab` retains this optional blockout and successful/missing-GLB checks. If city artwork fails to load, the renderer displays its walkable collision layout with an error. Scene disposal releases GPU resources, input listeners and late loader results.

## Voice, scoring and hosted services

The Sites frontend issues signed short-lived guest tickets; the separate Cloudflare Worker maps each room code to one authoritative Durable Object. Rooms support up to 32 guests with protocol 2. SQLite records consumed tickets; live positions and encounters remain in memory and reset after room shutdown or service restart. Signed admission identifies the socket guest, not a durable learner account or private-room invitation. See [the hosted-room guide](../../multiplayer/README.md) for runtime configuration, limits and deployment.

Player voice uses `player-voice-contract.ts`, `multiplayer/player-voice.ts` and the browser controller in `lib/voice/proximity.ts`. The Worker validates opt-in, authoritative range and per-pair sessions. Each player has at most seven mutual voice peers within 12 metres; this does not promise that every nearby player is audible. The browser requests microphone permission explicitly, transmits only while push-to-talk is held and cleans up audio/subscriptions on disable or disconnect. Solo and the direct Node development transport do not support player voice.

STUN discovery is configured; TURN is not provisioned. Real decoded microphone audio between computers on separate networks has not been verified. Signaling and synthetic/controller tests are not a WAN media or production-capacity claim.

`voice-contract.ts` derives whether a shared encounter member may transmit future NPC input and defines attributed transcript records. A future provider must check the accepted `speakerId`, membership and connection on every input stream/chunk; any member can claim the available turn. Ownership can transfer when a member leaves. End the provider session when the shared encounter ends, and release departed speakers' microphone routing immediately.

NPC voice, GPT/HeyGen sessions, lessons, transcript streams, real scores and persisted learner progress are not implemented. The Node NPC prototype from the original authoring checkout is absent from this release. [The partner handoff](../../docs/partner-integration-handoff.md) documents the actual integration boundary.

## Verification

From `web/`:

```sh
npm run test:world
npm run test:multiplayer
node scripts/prepare-rapier.mjs
node scripts/verify-player-voice.mjs
npx tsc --noEmit
npm run lint
npm run build
```

The combined release checkpoint passed **146 world/controller/asset tests**, **14 Miniflare/workerd multiplayer checks** and **nine hosted player-voice checks**. They cover actual assets/animations, movement and vehicles, shared encounters, signed admission, replay protection, 32-player capacity, bounded voice graphs and protocol compatibility. Later changes require their targeted checks. These tests need loopback access; visual behavior and real audio across separate networks require browser/device verification in addition to these checks.

## Graphics and camera follow-up

The depth-corrected city render release is `kyoto-city-v2-depth-fix-20260913`; its gameplay data and marker contract are unchanged. Venue surfaces are separated to remove coplanar flicker. The runtime smooths scenery cutaways and supports an optional third-person view: press V or use the camera button to switch smoothly from the default isometric view. Regression tests cover camera interpolation and visibility rays during projection transitions. See [graphics polish](../../docs/graphics-polish.md) and [the asset repair](../../../asset-fixes/venue-depth/README.md) for the asset repair and targeted graphics verification.


The atmosphere follows a shared server clock across joins, reconnects and background tabs. Time presets and pause switch only that browser to explicitly labelled personal lighting; **Return to shared time** restores the room's current phase. See [atmosphere](../../docs/atmosphere.md), [player actions](../../docs/player-actions.md) and [vehicles](../../docs/vehicles.md).
