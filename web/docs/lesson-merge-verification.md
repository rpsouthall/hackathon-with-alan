# Combined world and lesson build

Ryan's `fe16119` world release is merged with Alan's `c248a72` lesson checkpoint. The world remains protocol 2: signed hosted joins, 32-player rooms, all 15 residents, vehicles, sprint, emotes, day/night, compressed assets and player proximity voice are retained.

## Player flow

Create a traveller and join a room. Click **Find a Japanese lesson**, choose a tutor and **Walk to tutor**. Once in range, press E, click the NPC, or use **Start lesson**. Room authority admits the encounter before the camera focuses and the lesson opens. Mounted players must dismount first.

Eight mapped residents open six ten-question scenarios: coffee, market, restaurant, directions, inn and tea. Other residents retain the sample conversation. Each real lesson preserves Alan's glass layout, large Japanese/English prompts, Japanese-first model replies, transcript, typing/microphone answers, correction, quizzes, XP, retries and sound toggle. Closing restores world input and the previous camera. World controls are hidden during the cinematic lesson.

## Voice and progress boundaries

The shared world encounter is authoritative. The current lesson/HeyGen conversation is **private per browser**, as labeled in the lesson UI. Nearby-player capture and playback are disposed while the lesson is open and restored from the existing voice preference when it closes. NPC audio is not sent through the player voice signaling channel. Legacy sample encounters retain Ryan's shared speaking-turn controls.

The companion permits one paid avatar session at a time. A second learner can use lesson text/quizzes but cannot interrupt another browser's live avatar; they receive a busy message. Re-entering from the same tab waits for teardown before starting another avatar. Closing, disconnecting or changing NPC releases capture, video, sockets and pending setup. A shared, turn-taking GPT/HeyGen conversation across players is not implemented.

XP is per encounter, with rewards earned once per question. Transcripts and scores are not persisted to accounts. Feedback assesses recognized words and meaning, not acoustic pronunciation.

## Local startup

From `web/`, run `npm run dev:game`. In another terminal run `npm run dev:lesson` with the existing server-only `OPENAI_API_KEY`, `LIVEAVATAR_API_KEY` and `LIVEAVATAR_AVATAR_ID` environment variables loaded securely. Never place provider secrets in VITE variables or tracked files.

The frontend runs on 5173, room server on 8788, lesson companion on 8790. The companion accepts the two configured localhost origins. `npm run dev:game` deliberately does not load a developer's private credentials or start a paid session.

## Publishing boundary

The Sites artifact now includes authenticated native-Worker lesson routes for `/lesson-api/config` and `/lesson-api/session`; Vite's development proxy remains local-only. Production provider secrets must be configured through Sites. The signed multiplayer Worker remains a separate deployment, and lesson conversations remain private to each learner. See [lesson hosting and verification](../server/lesson/README.md#validation-and-deployment) for limits and checks. The prepared hosted routes have passed a local built-Worker connection check, but have not been published to the named live Site: the connected Sites account currently cannot access that project.

## Verification

- 153 world tests: assets, routefinding through actual city collision, cameras, movement, vehicles, emotes, signed transport and voice isolation.
- 27 lesson tests (including two-learner avatar isolation): all scenario mappings, assessment, rewards, sounds, microphone cancellation, avatar replacement, provider failure and cleanup.
- 14 local Miniflare multiplayer checks, including 32 clients and rejected 33rd admission.
- 9 hosted player-voice signaling checks, including no isolated newcomer and strict message validation.
- TypeScript, ESLint and production frontend build.
- Browser: join the merged world, walk to Aoi, open the glass lesson, decode live HeyGen video, receive lesson feedback, mute capture, and return to the world; mount/dismount a scooter, switch cameras and perform an emote.

Provider connections depend on credits/network availability. Automated provider tests use mocks; the browser video check uses the real configured service. Player voice across separate real networks and TURN relay connectivity remain unverified, as in Ryan's release.
