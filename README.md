# Hackathon with Alan

Komorebi is a Three.js browser game for exploring a Kyoto-inspired city together. The consolidated game includes character creation, 15 residents, shared encounters, sprinting, emotes, scooters, skateboards and a local day/night presentation. Hosted rooms support up to 32 players and opted-in player proximity voice. Japanese NPC speech, GPT/HeyGen sessions, lessons and real assessment remain future integrations.

## Run and play

Use Node.js 22.13 or newer. From the repository root:

```sh
cd web
npm ci
npm run dev:game
```

Open **http://localhost:5173**. Create your traveller in the welcome editor, enter a display name and room name, then choose **Join Kyoto**. Open another tab with a different name and the same room to explore together. **Play solo** runs the same city privately.

- Click the world, then use **WASD / arrows** or the on-screen walking buttons. Right-drag to orbit; scroll to zoom.
- Hold **Shift** to sprint, press **G** for emotes, **F** to mount/dismount a nearby vehicle and **V** to switch camera views.
- Walk near a resident and press **E**, click their label, or use **Start encounter**. Another nearby learner can join the encounter and take a speaking turn.
- Use **Character** to change your look; accepted changes appear for everyone in the room. **Room** changes the room connection.
- **View town** opens the overview; **Follow player** returns to walking. **Escape** leaves an encounter.

The local launcher starts both the frontend and Node room server for gameplay. For alternate ports, run `GAME_PORT=5183 WORLD_PORT=8789 npm run dev:game`. Both services bind to this computer; this command does not publish a multiplayer server. Nearby voice is available through the hosted transport and its Durable Object signaling service; solo and the direct Node development transport do not enable microphones or send voice messages.

## Consolidated game

The city contains a 68 × 54 m world, two bridges and eight furnished venues with open entrances. The gameplay manifest is `kyoto-city-v3-vehicles-20260913`, using the existing depth-corrected City v2 artwork. Client and server use **protocol 2**. Players share authoritative Rapier movement, validated cosmetics, six vehicles, NPC reservations and exclusive speaking turns. Any encounter participant can claim an available turn; departure clears that speaker and transfers encounter ownership when needed.

Hosted player voice uses push-to-talk and actual audio activity for speaking indicators, with at most seven voice peers within 12 metres. NPC conversations and feedback remain labelled examples; sample scores are not earned progress. TURN is not provisioned, and decoded microphone audio between real computers on separate networks has not been verified.

See [the world integration guide](web/lib/world/README.md) for asset provenance, Blender export contracts, multiplayer configuration and verification. Run `npm run test:world`, `npx tsc --noEmit` and `npm run lint` from `web/` for the integration checks. The `/world-lab` route retains the smaller blockout and asset-loading checks.

The [hosted multiplayer guide](web/multiplayer/README.md) covers the Cloudflare
Durable Object server, signed Site admission, 32-player rooms, deployment and
`npm run test:multiplayer`. Cloudflare authorization and email verification are
complete. The deployed server is `https://kyoto-shared-world.hello-d5e.workers.dev`;
real remote clients verified shared rooms, room isolation, movement, cosmetics,
voice signaling and disconnect cleanup. The public Site uses runtime configuration
to issue signed joins to this service. The [partner handoff](web/docs/partner-integration-handoff.md)
defines the future NPC voice, HeyGen and lessons boundary.

## Join the project

1. Accept the GitHub collaborator invitation using your own GitHub account.
2. Clone this repository:

```sh
git clone https://github.com/rpsouthall/hackathon-with-alan.git
```

3. Open the cloned folder as a local project in your coding app and choose Astra if available in your account.
4. Ask your agent to read this README before starting work.

## Blender skills

We use the 94 skills from [arjun988/blender-skills](https://github.com/arjun988/blender-skills).
Ryan installed revision `8f778d2405a214b508d4c7d80742be8e43acdd52` locally. Skills are not bundled in this repository.

On your own machine, ask your agent:

> Install all Blender skills from https://github.com/arjun988/blender-skills at revision 8f778d2405a214b508d4c7d80742be8e43acdd52.

Direct Blender control also requires the Blender MCP connection described in the upstream repository.

## Working together

- Pull the latest changes before starting.
- Use a separate branch for each piece of work and open a pull request.
- Coordinate before editing the same Blender scene; binary .blend files cannot be merged like source code.
- Keep decisions and setup instructions in this repository so both agents can read them.
