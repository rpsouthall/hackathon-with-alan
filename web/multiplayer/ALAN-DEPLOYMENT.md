# Alan's multiplayer deployment

This deployment uses Alan's Cloudflare account independently of Ryan's Worker.

- Game: https://kyoto-avatar-conversations.alan438227.chatgpt.site
- Worker: https://kyoto-alan-world-v3.alan-4fb.workers.dev
- Configuration: `multiplayer/wrangler.alan.jsonc`
- Cloudflare account: `4fbbf3827eda00b5b5d1174265db31d7`

From `web/`, deploy updates with the explicit Alan configuration:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js deploy --config multiplayer/wrangler.alan.jsonc
```

The existing `deploy:multiplayer` script targets Ryan's configuration. Do not use
that script to update Alan's server.

The Site runtime needs `WORLD_SERVER_URL` set to the Worker URL and
`WORLD_TICKET_SECRET` matching the Worker's secret. Keep any local recovery copy in an ignored environment file with owner-only
permissions. Do not commit, display, or place this secret in browser variables. Preserve the existing Site
lesson credentials when updating its runtime environment.

On September 13, 2026, the earlier production release passed health (protocol 2, capacity
32), shared membership, separate-room isolation, movement replication, mutual
voice rosters, voice-signal delivery, and disconnect cleanup. Local verification
passed 14 multiplayer checks and nine player-voice checks. The café encounter
test follows the real doorway before asserting that both guests can interact.

Public Site v10 was republished with runtime environment revision 2. Site-issued
tickets were accepted by this Worker, and two Chrome game sessions joined
`alan-hackathon` with the HUD showing both players online. The room invitation is
https://kyoto-avatar-conversations.alan438227.chatgpt.site/?room=alan-hackathon .

Players join the same room code, enable voice, and hold T or the talk button to
speak near one another. Voice signaling is hosted on this Worker; audio travels
between browser peers. TURN relay is not configured. Real microphone audio
between separate devices and networks still needs a two-person check.

This submission branch uses protocol 3 and a separate Worker so the current
protocol-2 deployment remains available during release. The Site frontend and
WORLD_SERVER_URL must switch together after the new Worker secret is configured.
The integrated protocol-3 source passes 247 world/lesson tests, 14 multiplayer
checks and nine hosted player-voice checks.
