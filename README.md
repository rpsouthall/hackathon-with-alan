# Kyoto Conversations · Komorebi

A Kyoto-inspired 3D language-learning game built at the Astra Hackathon. Explore together, meet local characters, and practise everyday Japanese through guided conversations and quizzes.

- **Public game:** https://kyoto-avatar-conversations.alan438227.chatgpt.site/
- **Shared demo room:** https://kyoto-avatar-conversations.alan438227.chatgpt.site/?room=alan-hackathon
- **Environment gallery:** https://kyoto-avatar-conversations.alan438227.chatgpt.site/environments

## Try the demo

1. Open the game, choose your appearance and display name, and select **Join Kyoto**. Friends should use the same room code. **Play solo** explores the city privately.
2. Enable nearby voice if you want to talk with other players. Allow microphone access, walk near one another, and **hold T** or the talk button to speak.
3. Choose a tutor and walk to their location. Café and restaurant tutors are inside their shops. Start a lesson when you are close enough.
4. Sign in with ChatGPT for a private live lesson. Choose easy or difficult, then respond in English or practise Japanese. Each scenario contains ten questions with feedback and a phrase recap.

The public world is accessible without signing in. Live lessons use server-side OpenAI and HeyGen LiveAvatar credentials. Each learner's avatar conversation is private, including in shared rooms.

## What is included

- A Three.js city with Rapier collision, character customisation, emotes, scooters and skateboards.
- Shared rooms for up to 32 players, server-authoritative movement, local movement prediction and synchronised world time.
- Opt-in proximity voice with push-to-talk, audio activity indicators and up to seven nearby peers within 12 metres.
- Lesson-backed tutors with assigned HeyGen avatars, shop-entry guidance, native-language support, quizzes and AI feedback.
- Coffee, fruit-market and restaurant environments, plus directions, inn and tea lessons.

Movement and room state run on a Cloudflare Durable Object service. The public Site serves the game and issues short-lived room tickets. The separate lesson service handles private voice/avatar sessions; provider keys are never shipped to the browser.

## Local development

Use Node.js 22.13 or newer. From the repository root:

```sh
cd web
npm ci
npm run dev:game
```

Open **http://localhost:5173**. This starts the frontend and the local Node gameplay server. Local gameplay does not include the hosted proximity-voice service by default. See the [multiplayer guide](web/multiplayer/README.md) for hosted-path development and [Alan's deployment guide](web/multiplayer/ALAN-DEPLOYMENT.md) for the submission server.

For local avatar lessons, configure an ignored environment file and follow the [lesson service guide](web/server/lesson/README.md). Production secrets belong in the hosting providers' runtime settings, not Git or frontend variables.

## Controls

- **WASD / arrows:** walk; **Shift:** sprint.
- **E:** interact with a nearby tutor; **Escape:** leave an encounter.
- **T:** hold to talk to nearby players when voice is enabled.
- **G:** emotes; **F:** mount or dismount a nearby vehicle; **V:** change camera view.
- **Menu:** edit your character or room; **View town:** open the overview.

## Validation and demo limits

From `web/`, run `npm run test:world`, `npm run test:lesson`, `npm run test:multiplayer`, `npx tsc --noEmit` and `npm run lint`. The [integration notes](web/docs/lesson-merge-verification.md) describe lesson behaviour and the separate provider, microphone and media checks.

Rooms are temporary: reconnecting does not preserve a traveller's world position or progress. Nearby voice uses a bounded peer graph, so it does not promise that every nearby person is audible in a busy room. Cross-device audio and restrictive-network connectivity need a real-device check; passing signalling tests alone does not establish audible voice. A live avatar demo also needs working provider access and available credits.

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
