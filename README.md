# Hackathon with Alan

Komorebi is a browser game for exploring a Kyoto-inspired city together and practising Japanese with its residents. The consolidated Three.js game includes the city, character editor, complete cast and multiplayer encounters. Live voice and real assessment are the next integration step.

## Run and play

Use Node.js 22.13 or newer. From the repository root:

```sh
cd web
npm ci
npm run dev:game
```

Open **http://localhost:5173**. Create your traveller in the welcome editor, enter a display name and room name, then choose **Join shared room**. Open another tab with a different name and the same room to explore together. **Play solo** runs the same city privately.

- Click the world, then use **WASD / arrows** or the on-screen walking buttons. Right-drag to orbit; scroll to zoom.
- Walk near a resident and press **E**, click their label, or use **Start encounter**. Another nearby learner can join the encounter and take a speaking turn.
- Use **Character** to change your look; accepted changes appear for everyone in the room. **Room** changes the room connection.
- **View town** opens the overview; **Follow player** returns to walking. **Escape** leaves an encounter.

The local launcher starts both the frontend and room server. For alternate ports, run `GAME_PORT=5183 WORLD_PORT=8789 npm run dev:game`. Both services bind to this computer; this command does not publish a multiplayer server.

## Consolidated game

The current city release, `kyoto-city-v2-final-20260913`, contains a 68 × 54 m world, two bridges, eight furnished venues with open entrances, and 15 distinct residents. Players share authoritative Rapier movement, validated character cosmetics, NPC reservations and exclusive speaking turns. Conversations and feedback are clearly labelled examples; no microphone or GPT-Live voice session is connected, and sample scores are not earned progress.

See [the world integration guide](web/lib/world/README.md) for asset provenance, Blender export contracts, multiplayer configuration and verification. Run `npm run test:world`, `npx tsc --noEmit` and `npm run lint` from `web/` for the integration checks. The `/world-lab` route retains the smaller blockout and asset-loading checks.

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
