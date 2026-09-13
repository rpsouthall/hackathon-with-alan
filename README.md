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

## Live Japanese conversation milestone

Alan owns backend/voice on `codex/alan-backend-voice`; Ryan owns frontend/3D.
The current voice test uses OpenAI GPT-Live 1 for a two-way spoken Japanese conversation
with Aiko. See [local voice test and integration plan](docs/GPT-LIVE-TEST.md).
Run it with `cd backend && npm ci && npm run dev:live`, then open http://localhost:8787/.
The API key belongs only in the ignored `backend/.env` file as `OPENAI_API_KEY`.

Ryan's game is on `codex/world-integration`. The voice test runs separately while
NPC changes are in progress. Game dialogue integration, HeyGen video, and Sites
deployment remain to be completed. The older Inworld/HeyGen prototype is retained
in [the earlier handoff](docs/VOICE-HANDOFF.md); it is not used by `dev:live`.
Run backend checks with `cd backend && npm test`.
