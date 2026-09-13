# World integration contract

This module is the shared boundary between the React frontend, a later Blender environment, NPC encounters and multiplayer. The current renderer is an intentionally simple blockout. It does not include a GPT-Live audio bridge or an assessment service.

## Frontend integration

```tsx
import { WorldProvider, useWorld } from "@/components/world/world-provider";
import { WorldViewport } from "@/components/world/world-viewport";

function World() {
  const { snapshot, localPlayerId, connection, send } = useWorld();
  if (!snapshot) return <p>{connection}</p>;
  const active = snapshot.encounters.find(e => e.participantIds.includes(localPlayerId ?? ""));
  return <WorldViewport
    environment={snapshot.environment}
    players={snapshot.players}
    npcs={snapshot.npcs}
    localPlayerId={localPlayerId}
    inputEnabled={!active && connection === "connected"}
    onMove={(direction, yaw) => send({ type: "move", direction, yaw, sequence: 0 })}
    onInteract={npcId => send({ type: "interact", npcId })}
  />;
}

export function Experience() {
  return <WorldProvider playerName="Learner"><World /></WorldProvider>;
}
```

- `WorldProvider` creates an isolated local preview unless given a transport. Label it using `mode` (`local` or `multiplayer`), and display `connection` and `error`.
- Memoize an injected transport: `useMemo(() => createWebSocketTransport(url), [url])`. Do not create a new transport on every render.
- `snapshot` and `localPlayerId` are null until joining succeeds and are cleared on disconnect. Disable interactions while disconnected. Network failure never silently becomes a private offline world.
- The store replaces caller movement sequence values with monotonic sequences. Send input directions, not client-authored positions.
- `interact` requests an NPC reservation. Show the conversation only after `snapshot.encounters` contains the local player's membership. Selecting a portrait does not grant a reservation.
- If a nearby NPC is busy, use `join-encounter` with its encounter ID. `claim-turn` and `release-turn` enforce one speaker. Listeners remain members.
- Escape, leaving a conversation, finishing and retry flows must release/reacquire membership appropriately. `leave-encounter` removes only the local participant. Other learners remain in the encounter; the owner role transfers on exit.
- Canonical NPC IDs: `cafe_owner`, `local_guide`, `shopkeeper`. Current display names: Aiko, Haru, Mei. UI colours/Japanese names can be mapped by ID. Do not store a second set of authoritative NPC coordinates in frontend fixtures.
- A replacement renderer can consume the same snapshots/callbacks. Do not run independent client physics and server movement as competing authorities. Add prediction/reconciliation deliberately if needed.

## Drop in a Blender environment

1. Export a **glTF 2.0 binary (`.glb`)** with materials/textures. Initial loader supports ordinary, uncompressed GLBs. Draco/KTX2 compressed assets require decoder configuration in `scene.ts` before use.
2. Keep exported world coordinates in meters, glTF Y-up, ground at the player spawn's Y. Apply asset transforms before export. The runtime does not rescale the artwork to an arbitrary bounding box.
3. Put the file at `web/public/models/kyoto.glb` or a versioned HTTPS asset URL with appropriate CORS headers. Configure `assetUrl` in the **server-owned** environment manifest (see `defaults.ts`), bump `revision`, and restart/rejoin rooms. All clients then receive the same asset revision and layout.
4. Set `spawn`, `bounds`, `npcSpawns` and simple AABB `colliders` in the same exported coordinate system. Ground-origin positions describe player/NPC feet, not mesh centres. The scene adds a 0.7m offset for its placeholder capsules only.
5. Use the stable NPC IDs to place characters. `npcSpawns` takes precedence over descriptor positions. Keep NPC avatars separate from static environment geometry to avoid duplicate visible characters.
6. Optional named Blender nodes `SPAWN_*` and `COLLIDER_*` are hidden by the renderer. They are **not automatically imported into authority**. Copy/export their coordinates into the manifest. A future Blender exporter can automate that step; do not trust client-side GLB metadata to set multiplayer positions.
7. Set an NPC's `avatarUrl` to a separate meter-scale, feet-origin GLB. It loads in place of the capsule and plays an `idle` clip (or the first clip). Missing avatar files preserve the capsule. Exact mouth animation and speaking gestures are future voice-presentation work.
8. Confirm the spawn does not intersect obstacles, paths are wide enough for a 0.3m player radius, and characters are reachable within `interactionRadius`. Test in `/world-lab` before polishing.

The current authoritative movement supports **one flat floor with box obstacles and world boundaries**. It has no terrain raycasts, stairs, jumping, moving platforms, player-vs-player collisions or line-of-sight interaction test. A sloped bridge or multi-level scene needs a server-compatible physics/navmesh controller; replacing `WorldRoom.tick` can preserve the rest of the frontend contract. Do not advertise arbitrary terrain support merely because a GLB renders.

GLB failures keep the blockout visible with an error message. Scene changes/unmounts remove input listeners, stop animation frames, dispose meshes/materials/textures and discard late loader results. Three.js is loaded client-side after mounting; no WebGL work runs during SSR.

## Multiplayer verification

From `web/`:

```sh
npm run dev
npm run dev:world
```

Open `http://localhost:5173/world-lab` in two tabs. Set different display names, the same room name and `ws://127.0.0.1:8788/world`. Both should show two players. Focus the canvas and use WASD/arrows to walk. Press E near an NPC; the other player can walk close and join through the character list. Claim/release a turn, leave a tab and verify cleanup.

If the frontend uses another port, set `WORLD_ALLOWED_ORIGINS` on the room server to a comma-separated list of those exact origins. `WORLD_PORT` changes the room server port. The demo server binds **127.0.0.1**. It is a single-process, in-memory guest service, not a durable multiplayer deployment. It limits rooms, players, messages and payloads, assigns player IDs server-side, expires stale movement, checks interaction distance, isolates rooms and reaps disconnected guests. Reconnect creates a new guest identity; it does not restore a voice session.

The Sites frontend builds into a Cloudflare Worker. A `ws` server cannot be placed in an ordinary page/API route and expected to retain global room state across Worker instances. Host the room service separately, or port the room kernel into an authoritative per-room service such as a Durable Object. Before public deployment, add authenticated upgrade/session validation, room membership/invite policy, TLS (`wss://`), durable identity/rejoin and appropriate state persistence. The Origin allowlist is a browser check, not authentication.

## Voice and evaluation boundary

`voice-contract.ts` defines encounter/participant attribution and derives whether a player may transmit. The future voice backend must call this against its authoritative room snapshot and authenticated player ID; browser copies are display-only. Use one NPC voice session per shared encounter and route its audio to all listeners. Only the current speaker's audio may enter that session. Clear/disable microphone routing on lost membership, lost turn or disconnect. No voice-session request or microphone capture happens in this module.

Transcript records must carry room ID, encounter ID, player/NPC identity and audio timestamps. Preserve overlaps. Evaluate individual contributions rather than assigning the entire group one person's score. Sample transcripts/results must be labelled as previews and never persisted as earned achievements.

## Checks

```sh
npm run test:world
npx tsc --noEmit
npx eslint lib/world components/world tests/world app/world-lab
npm run build
```

The tests use real loopback sockets and the real Three.js GLB parser, alongside room/store tests. The tiny `public/world-fixtures/courtyard.glb` is a test floor, not finished artwork. `/world-lab` offers both a successful GLB-load check and an intentionally missing-file fallback check.
