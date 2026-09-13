# Hosted Kyoto rooms

The ChatGPT Site serves the Three.js game and issues a 60-second HMAC admission
ticket from `POST /api/world/join`. The browser connects directly to this Cloudflare
Worker using WebSockets. A room code selects one Durable Object, which owns the
Rapier simulation, players, cosmetics, NPC encounters and speaking turns.

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
- Guests may send 80 messages per second, including at most 10 non-movement
  actions. Oversized or malformed messages close the connection.
- Admission allows 120 valid-ticket attempts per minute per network and Cloudflare
  location. This deliberately permits a shared hackathon Wi-Fi. It is an abuse
  throttle, not a strict global quota or a substitute for durable user accounts.
- Unjoined sockets expire after 12 seconds; idle connections after 45 seconds.
  The browser sends heartbeats and reconnects with a fresh identity and ticket.
- Live simulation is in memory. Empty rooms stop their timers and release physics;
  restart/reconnect does not preserve positions, encounters or earned progress.
  An occupied room uses active WebSockets and a simulation timer, not hibernation.
- Voice audio, GPT sessions and conversation ratings are not implemented in this
  Worker. Current shared NPC turn state is ready for a separately validated voice
  integration. Do not copy Node-only signaling or activate its UI without porting it.

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

## Verification checkpoint

On 2026-09-13, 70 game tests, TypeScript, ESLint, the Site production build and
Wrangler dry-run passed. `npm run test:multiplayer` passed 14 checks in actual
Miniflare/workerd: signed joins, appearance/movement replication, room isolation,
forgery/expiry/replay, persistent replay rejection, shared NPC ownership, cleanup,
32 simultaneous clients, capacity rejection, action floods and admission throttling.
The load test sent 3,840 movement inputs and reported zero protocol errors. These
are local correctness checks, not a production latency or sustained-capacity claim.

Two real browser tabs also joined through the Site API locally, rendered the full
city and both named avatars, showed two members and copied a room invite link.
Public end-to-end verification remains pending Cloudflare deployment authorization.

Current protocol is 1. Other development threads have protocol 2 sprint, emotes,
vehicles and voice additions: merge their fields deliberately, preserve the
32-player limits and signed transport, and release compatible client/server code
together. Their Node voice server cannot be deployed as this Worker unchanged.
