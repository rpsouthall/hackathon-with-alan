# Hackathon with Alan

Shared workspace for Ryan and Alan’s new Blender project.

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

## Current status

The `web/` frontend now includes the Kyoto conversation UI, a replaceable GLB viewport, and a shared world-state layer. A local WebSocket room server verifies multiplayer movement, NPC reservations, shared encounters and speaking turns. GPT-Live audio routing and real conversation assessment are not connected yet.

See [the world integration guide](web/lib/world/README.md) for frontend contracts, Blender export requirements, multiplayer setup and known limitations. The `/world-lab` route tests the world independently of the game UI. Run `npm run test:world` from `web/` for the room, network and GLB loader checks.
