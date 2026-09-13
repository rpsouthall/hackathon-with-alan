# Hosted Kyoto rooms

The ChatGPT Site serves the Three.js game and issues a 60-second HMAC admission
ticket from `POST /api/world/join`. The browser connects directly to this Cloudflare
Worker using WebSockets. A room code selects one Durable Object, which owns the
Rapier simulation, players, cosmetics, vehicles, NPC encounters and speaking turns.
Client and server use gameplay protocol 2. This Worker also authorizes and relays
player proximity-voice signaling; media flows through browser WebRTC peers.

The default room is `kyoto`. Friends can use another code or the Room → Copy room
link button. Codes are case-insensitive, 1–48 letters, digits, dashes or underscores.
Each room admits up to 32 guests. This is a room-based hackathon game, not a
persistent MMO with thousands of players in one simulation.

## Deployment

Use the existing project-local Wrangler. Authenticate with `wrangler login`, check
`wrangler whoami`, and select the intended Cloudflare account before deploying.
The Worker name is `kyoto-shared-world`; its config is `multiplayer/wrangler.jsonc`.
It creates a SQLite Durable Object namespace and an admission rate-limit binding.
If the account offers a paid upgrade, get the account owner's approval first.

From `web/`:

```sh
npm run build:multiplayer
npm run deploy:multiplayer
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js secret put WORLD_TICKET_SECRET --config multiplayer/wrangler.jsonc
```

Enter a cryptographically random secret of at least 32 bytes through Wrangler's
protected input. Configure that same value as the ChatGPT Site's secret
`WORLD_TICKET_SECRET`. Set the Site's `WORLD_SERVER_URL` to the exact HTTPS URL
reported by the successful Worker deployment. These are runtime values, never
`VITE_` variables or committed files. The Worker must allow the exact Site origin
in `WORLD_ALLOWED_ORIGINS`.

Publish the matching Site source through the Sites hosting workflow after the
backend is configured. Verify `/health`, then join through the public Site from
two browsers and check shared movement, appearances, invitations and disconnects.
The Site defaults to the hosted connection on public domains. Missing runtime
configuration produces an explicit unavailable message; it never silently joins
an isolated local simulation.

## Local hosted-path development

Create ignored `web/.dev.vars` with `WORLD_SERVER_URL=http://127.0.0.1:8792` and
`WORLD_TICKET_SECRET` set to a disposable local secret. Create ignored
`web/multiplayer/.dev.vars` with the same local secret and
`WORLD_ALLOWED_ORIGINS=http://127.0.0.1:5190`. Create ignored `web/.env.local` with
`VITE_WORLD_SERVER_URL=hosted` to exercise signed joins on localhost.

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js dev --config multiplayer/wrangler.jsonc --port 8792 --ip 127.0.0.1 --inspector-port 0
```

In another terminal, run `npm run dev -- --port 5190 --hostname 127.0.0.1`.
Remove the localhost hosted override when returning to the legacy `dev:game`
Node server. Local secrets are not deployed by Wrangler or Sites.

## Runtime and limits

- Server-authoritative movement and collision; state broadcasts are coalesced to
  at most 20 Hz. Only the initial welcome includes the static environment manifest.
- Tickets bind the guest name, identity, room and Site origin. Single-use nonces
  are recorded in SQLite so replay protection survives Worker restarts.
- Gameplay permits 80 messages per second, including at most 10 non-movement
  actions, with a 4,096-character message limit. Voice signaling has separate
  limits: 120 ICE, 16 SDP and 10 opt-in/out messages per second. Combined ingress
  is capped at 256 messages and 512 KiB per second. Voice envelopes are limited
  to 20,000 characters; malformed or oversized traffic closes the connection.
- Admission allows 120 valid-ticket attempts per minute per network and Cloudflare
  location. This deliberately permits a shared hackathon Wi-Fi. It is an abuse
  throttle, not a strict global quota or a substitute for durable user accounts.
- Unjoined sockets expire after 12 seconds; idle connections after 45 seconds.
  The browser sends heartbeats and reconnects with a fresh identity and ticket.
- Live simulation is in memory. Empty rooms stop their timers and release physics;
  restart/reconnect does not preserve positions, encounters or earned progress.
  An occupied room uses active WebSockets and a simulation timer, not hibernation.
- NPC audio, GPT/HeyGen sessions, lessons and conversation ratings are not
  implemented. Any encounter member may claim an available exclusive speaking
  turn. Leaving clears that learner's turn and transfers ownership as needed; the
  encounter ends when its final member leaves. These permissions do not open a
  provider session. See [the partner handoff](../docs/partner-integration-handoff.md).

The rate limiter is location-scoped and eventually consistent, as described in
[Cloudflare's rate-limit documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).

## Physics build

`prepare-rapier.mjs` generates a Worker-only adapter from the locked Rapier 0.19.0
package's source map and WASM. It preserves the same physics code used by the
browser but imports precompiled WASM, avoiding dynamic compilation in Workers.
Generated artifacts are ignored. The source map hash is pinned and the Apache 2.0
license is retained under `third-party/`. Review the generator when upgrading Rapier.
The runtime date is pinned to 2026-05-15 to match the installed Workers types and
the available local runtime; advancing it requires revalidation.

Regenerate binding declarations after changing the config:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js types multiplayer/bindings.d.ts --config multiplayer/wrangler.jsonc --env-interface KyotoWorkerEnv --include-runtime=false --strict-vars=false
```

## Player voice and local capability

Nearby player voice is available through `createHostedTransport()` and this
Cloudflare room service. `npm run dev:game`, solo play and direct
`createWebSocketTransport(url)` connections provide gameplay only by default.
The local welcome skips microphone permission, and the voice panel reports voice
unavailable without opening a microphone or sending voice envelopes. The explicit
`supportsPlayerVoice` capability gates both UI and transport/store; it is not
inferred merely from multiplayer mode. Only a verified voice-capable server should
use the direct transport's explicit `{ playerVoice: true }` opt-in.

Players explicitly enable voice and hold T or the talk button to transmit. The
Worker derives signaling identity from the admitted socket, validates room/range
and per-pair session IDs, and maintains at most seven mutual voice peers per
opted-in player within 12 metres. It rebalances isolated newcomers while retaining
eligible connections. This bounded graph does not guarantee every nearby player
is audible. Clients that have not opted in receive no unsolicited voice roster.
Audio activity, rather than an open microphone alone, drives speaking indicators.

The default ICE configuration contains STUN. TURN is not provisioned. Real decoded
microphone audio between computers on separate networks has not been verified;
local tests do not establish restrictive-network connectivity. The Worker handles
signaling, not media forwarding: media range enforcement also depends on the
supplied browser client closing audio when the roster changes.

## Verification checkpoint

On 2026-09-13, the combined release passed 146 world/controller/asset tests,
14 multiplayer checks and nine hosted player-voice checks in Miniflare/workerd.
The local capability gate adds four targeted regression tests. TypeScript and
lint checks are run separately from production builds. Use these commands from
`web/` to verify the current checkout:

```sh
npm run test:world
npm run test:multiplayer
node scripts/prepare-rapier.mjs
node scripts/verify-player-voice.mjs
npx tsc --noEmit
npm run lint
npm run build
npm run build:multiplayer
```

Coverage includes signed joins, appearance/movement/vehicle replication, room
isolation, forgery/expiry/replay, persistent replay rejection, shared encounter
turns/ownership, cleanup, 32-player capacity, action/admission throttling, bounded
voice graphs, isolated newcomers, signaling identity and legacy-client behavior.
These are local correctness checks, not a production latency, sustained-capacity
or WAN media claim. Public browser joins and real microphone audio must be assessed separately.

Cloudflare authorization, email verification and server deployment are complete.
The server at `https://kyoto-shared-world.hello-d5e.workers.dev` reports protocol 2
and capacity 32. Three real remote WebSocket clients verified shared membership,
room isolation, the 15-resident/six-vehicle snapshot, movement, cosmetics, voice
signaling and disconnect cleanup. These checks did not transmit microphone audio.
The public Site has the server URL and matching admission secret configured.
Release matching protocol-2 frontend and backend code together. Do not copy the
older Node prototype over this signed hosted service.
