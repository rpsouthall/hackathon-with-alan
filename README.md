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

Project repository initialized. The project brief and first Blender scene are still to be defined.

## Japanese → English voice milestone

Alan owns backend/voice on `codex/alan-backend-voice`; Ryan owns frontend/3D.
The initial interpreter uses ElevenLabs Agents with HeyGen LiveAvatar's official
connector. See [voice setup and frontend contract](docs/VOICE-HANDOFF.md).
Run backend checks with `cd backend && npm test`. Live credentials and a Sites
route wrapper are still required; this repository does not yet contain a deployed app.
