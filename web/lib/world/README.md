# Consolidated world integration

The game renders the final Kyoto City v2 environment and all 15 residents in Three.js. A shared character editor creates each player's traveller. Rapier resolves player movement against the exported city collision boxes; local solo play and the multiplayer server use the same `WorldRoom` implementation. Japanese conversations and feedback remain labelled samples: voice capture, GPT-Live sessions and real assessment are not connected.

## Run and play

From `web/`, with Node.js 22.13 or newer:

```sh
npm ci
npm run dev:game
```

Open **http://127.0.0.1:5173**. The welcome screen lets you choose a name, room and appearance, with a live 3D preview. **Join shared room** connects to the local room server; **Play solo** opens a private copy of the city. For multiplayer verification, use two tabs with different names and the same room name.

| Control | Action |
| --- | --- |
| Click the world, then WASD / arrows | Walk relative to the camera |
| On-screen arrows | Short walking steps |
| Right-drag / scroll | Orbit / zoom |
| E near a resident, their label, or Start encounter | Request a conversation; distance is checked by the authority |
| Join encounter | Join a nearby resident's existing group |
| Claim / release speaking turn | Select the group's one permitted speaker; no microphone is opened yet |
| Escape / Finish | Leave your encounter membership |
| Character / Room | Change your shared appearance / connection |
| View town / Follow player | Switch between overview and walking views |

`GAME_PORT=5183 WORLD_PORT=8789 npm run dev:game` changes both ports and configures the matching browser Origin allowlist. The launcher runs both services on loopback and stops them together. It does not publish a server or make it available to other computers.

For separate processes, run `npm run dev` and `npm run dev:world`. Set `WORLD_ALLOWED_ORIGINS` to a comma-separated list of exact frontend origins when their ports differ. `WORLD_PORT` defaults to `8788`. The standalone main page defaults to `ws://127.0.0.1:8788/world` on localhost; set the public `VITE_WORLD_SERVER_URL` at frontend build/dev startup to supply another `ws://` or `wss://` room endpoint. That value is visible to browsers and must contain no secret. `dev:game` always wires its own local endpoint.

## Included assets and provenance

The city release is **`kyoto-city-v2-final-20260913`**, with a 68 × 54 m footprint, two bridges, eight enterable furnished venues, 41 placement markers, 294 rotated collision boxes and 16 interior lights. The game loads the lighter city GLB. The original three central buildings remain exterior-only; the eight newer venues have accessible ground floors. Upper residential floors are decorative.

Authoring sources live in the main checkout's **`kyoto_city/`** and **`npcs/`** folders (`/Users/ryansouthall/Documents/ChatGPT/Hackathon with Alan` on the authoring machine). The consolidated worktree contains the runtime exports, not copies of every Blender source or authoring preview.

| Consolidated file | Source |
| --- | --- |
| `public/models/kyoto/kyoto_city_lod1.glb` | `kyoto_city/exports/kyoto_city_lod1.glb` |
| `lib/world/data/kyoto-city-gameplay.json` | `kyoto_city/exports/kyoto_city_gameplay.json` |
| `public/models/kyoto/RELEASE.json` | `kyoto_city/RELEASE.json` |
| `public/models/characters/komorebi_npc.glb` | `npcs/exports/komorebi_npc.glb` |
| `lib/characters/presets.ts` | The 15 identities/appearances from `npcs/exports/kyoto_city_cast.json`, adapted to the shared schema |

The copied city GLB and gameplay data match the SHA-256 entries in [RELEASE.json](../../public/models/kyoto/RELEASE.json) (the source lists the full-detail export too; this game uses LOD1):

```text
kyoto_city_lod1.glb       54f24eb271c7aee2efdf022f5ba9440471a9c71f26485d9dc4b80b1e08512700
kyoto-city-gameplay.json fcf0eb34ccadbab6422c54c4faec0e7a23439320f35fe778b99ab93ae2c764ac
komorebi_npc.glb         45bb1fdbe87b4a7f21c0260a66a356465fa77f941c172cb03422e22bb761e232
```

The NPC hash records the matching source export; it is not an entry in the city's release manifest. The city and character geometry are original assets from these authoring threads. The earlier Sketchfab reference is not embedded in the game.

## Runtime contracts

- **`kyoto.ts`** builds the city manifest and all 15 NPC descriptors from the final gameplay export and shared cast presets. Stable marker IDs connect appearance, position, venue and conversation presentation. `npcSpawns` overrides descriptor positions; venue hosts face their authored interaction points.
- **`WorldProvider` / `useWorld`** expose the room snapshot, local player ID, connection status, errors and command sender. Supply a memoized `createLocalTransport({ environment: KYOTO_ENVIRONMENT, npcs: KYOTO_NPCS })` for solo city play or `createWebSocketTransport(url)` for a shared room. The provider's unconfigured default remains the small blockout.
- **`WorldViewport` / `scene.ts`** render and interpolate authoritative positions. They load Three.js after mounting, show labels and selection rings, animate independent character instances, follow the player and fade obstructing scenery. They send movement directions and interaction requests, never authoritative positions.
- **`WorldRoom` / `physics.ts`** own movement, collision, players and encounters. `initWorldPhysics()` must finish before constructing a room whose manifest has `physics`; local transport and server startup already handle that requirement. Empty rooms and unmounted local sessions dispose their Rapier worlds.
- **`schema.ts` / `store.ts`** validate commands and state. The authority assigns player IDs. The store assigns monotonic movement sequence numbers, ignores stale/cross-room updates and clears identity/state on disconnect.

The multiplayer server sends the full environment once in `welcome`. Subsequent `state` messages contain players, NPCs, encounters and the environment revision, omitting the large static physics/lighting manifest. Movement changes publish at the 20 Hz room tick; encounter and appearance commands publish immediately. The store combines matching state with the accepted welcome environment. A changed environment revision requires a new welcome/rejoin. Local transport also uses compact state; full snapshots remain supported for compatibility.

An interaction becomes active only after the authority grants encounter membership. Selecting a portrait does not reserve an NPC. One encounter can contain multiple nearby learners; one participant can claim the speaking turn. Leaving or disconnecting removes only that learner, transfers encounter ownership as needed, clears a departing speaker and frees the NPC when the last learner leaves. Players stop walking during an encounter.

## Characters and customization

`lib/characters/avatar.ts` loads the shared customization GLB, clones its skeleton per actor and isolates materials, animation mixers and facial morphs. `presets.ts` provides all 15 residents. Each player supplies a validated `appearance` containing hairstyle, outfit, glasses, bag, height and six color channels. `set-appearance` changes only the connected player's cosmetics; identities and positions are not part of that command.

The welcome editor and in-game editor use this same runtime. Saved cosmetics are stored locally only after the authority accepts them, then sent again when a fresh guest joins. Other players see the accepted values. Local storage does not grant identity or room membership.

The visual height range is **1.4–2.1 m**. Every player uses the same **1.7 m tall, 0.28 m radius physics capsule**, regardless of appearance. Visible arms/clothing can extend beyond that capsule. The shared GLB supplies seven clips—Idle, Walk, Run, Wave, Bow, Talk and Listen—plus independent Blink and MouthOpen morphs. Animation previews and mouth controls are available, but actual NPC voice audio is not driving them yet. Residents remain at their authored locations; autonomous multiplayer patrol/pathfinding is not implemented.

The active renderer uses the shared `komorebi_npc.glb` customization template for the cast and players. Replacing it with a different rig needs an adapter for its part metadata, material channels, skeleton and clip names. Setting a descriptor's `avatarUrl` alone does not configure another character rig in this renderer.

## Replace or extend the Blender world

1. Export an ordinary, uncompressed **glTF 2.0 binary (`.glb`)** and gameplay data together. Exported coordinates are **metres, Y-up**, with player/NPC positions at their feet. The existing exports are already converted from Blender's Z-up coordinates; do not rotate or rescale them again. Preserve vertex colors used by trees and other materials.
2. Put the GLB under `public/models/` or use a versioned HTTPS asset URL with suitable CORS. Update the server-owned manifest in `kyoto.ts`, including its `assetUrl`, `revision`, `spawn`, `bounds`, `npcSpawns`, lights and collision data. Restart/rejoin rooms so every client receives the same revision. Exported GLB markers alone do not change multiplayer authority.
3. Supply rotated boxes as `physics.colliders: [{ name?, position: [x,y,z], halfExtents: [hx,hy,hz], quaternion: [x,y,z,w] }]`. The current controller uses gravity −9.81 m/s², a 0.22 m autostep, a 35° slope limit and 0.30 m ground snap. Physics advances at fixed 1/60 s substeps; movement speed and maximum elapsed time are controlled by the authority. Falling below bounds respawns the player.
4. Retain stable NPC IDs and unobstructed interaction positions. The 15 city identities consist of `cafe_owner`, `local_guide`, `inn_host`, four `market_*` vendors and eight venue `_host` IDs listed in `RELEASE.json`. Add matching descriptors and appearance/presentation entries for new residents.
5. Keep NPC meshes separate from static scenery. `MARK_*`, `SM_COL_*`, `SPAWN_*` and `COLLIDER_*` helpers are hidden by the renderer. Use the exported collider data for gameplay instead of collision tests against every decorative triangle.
6. Re-run the route and loader checks, then inspect the loaded world in a browser. New terrain must be tested with the actual authority; a successful GLB load does not establish that a route is walkable. Draco/KTX2 compression needs explicit decoder configuration before using those assets.

Bridge slopes and authored stairs are supported and tested. Jumping, moving platforms, player-to-player collision, NPC pathfinding and line-of-sight conversation checks are not implemented. A manifest without `physics` uses the original flat-floor/AABB controller in `defaults.ts`; `/world-lab` retains this optional blockout and successful/missing-GLB checks. If city artwork fails to load, the renderer displays its walkable collision layout with an error. Scene disposal releases GPU resources, input listeners and late loader results.

## Voice, scoring and production services

`voice-contract.ts` derives whether an encounter member may transmit and defines attributed transcript records. A future voice backend must check that contract against its authoritative snapshot and an authenticated player ID. Use one NPC voice session per shared encounter, route output to its listeners, admit only the current speaker's input and stop microphone routing when turn, membership or connection is lost.

Transcript records carry room, encounter, speaker identity and audio timestamps. Assess each learner's contributions, including overlap handling, rather than assigning a group one person's score. Current sample dialogue and feedback are previews; no microphone capture, GPT-Live request or real score persistence occurs.

The current room server is a single-process, in-memory **guest service bound to 127.0.0.1**. It enforces room capacity, input limits, server-assigned IDs, interaction distance and disconnect cleanup. Its Origin allowlist is not authentication. Reconnect creates a fresh guest. Public multiplayer needs authenticated sessions, room/invite policy, TLS (`wss://`), appropriate persistence and an accessible authoritative room host.

The frontend's build targets a Cloudflare Worker. The Node `ws` room server must run separately, or the room kernel must be adapted to a durable per-room service. An ordinary frontend route cannot reliably hold shared room state across Worker instances. `VITE_WORLD_SERVER_URL` selects a server endpoint; it does not deploy that server. These instructions make no public-hosting claim.

## Verification

From `web/`:

```sh
npm run test:world
npx tsc --noEmit
npm run lint
npm run build
```

The consolidated suite currently contains **43 tests**: actual Three.js GLB loading and independent character animation/customization; real WebSocket clients, shared cosmetics, compact state and encounter turns; authoritative movement through both bridges and all eight venues; interaction with every one of the 15 residents; stairs, bounds, falling respawn, stale input and cleanup. These tests require loopback socket access. Browser controls, visual appearance and performance need browser verification in addition to these headless checks.
