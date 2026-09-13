# Player voice, NPC voice and lessons handoff

> This is Ryan’s pre-merge handoff. The lesson integration described here as future work has now been merged as private per-browser lessons. See [the combined build and verification notes](lesson-merge-verification.md) for current behavior and deployment boundaries.

The consolidated checkout owns the Kyoto scene, character editor, 15 residents, authoritative movement, cameras, sprint, emotes, vehicles, room membership and shared NPC encounters. Its hosted Durable Object service includes player-to-player proximity voice signaling. NPC speech, GPT/HeyGen sessions, real lessons, transcripts, assessment and saved learner progress remain future work. Sample dialogue and feedback are not completed lessons or earned scores.

## Start from the consolidated checkout

Use the release branch/PR, then create a separate branch for the partner integration. Do not replace this checkout with the older authoring frontend. Preserve the signed hosted transport, admission controls and 32-player limit. Client and server must use **protocol 2** for sprint, emotes and vehicles.

From `web/`, run `npm ci` and `npm run dev:game` for local gameplay. Solo and the direct Node development transport do not support player voice. The signed hosted transport does, including local testing against the Durable Object service; follow [the hosted-room guide](../multiplayer/README.md). The Sites frontend and multiplayer Worker are separate deployments. A passing local build is not confirmation that both public services are configured.

## Existing integration points

| Area | Files in this checkout | Integration boundary |
| --- | --- | --- |
| Game and lessons UI | `components/game/game-experience.tsx` | Replace sample conversation/results with real lesson states while retaining hosted joins, character editing and world controls. |
| NPC identity | `lib/game/contracts.ts`, `lib/world/kyoto.ts` | Map stable `npc.id` and `scenarioId` to lessons/provider personas. Display names are not identifiers. |
| World and encounter authority | `lib/world/room.ts`, `lib/world/schema.ts`, `components/world/world-provider.tsx` | Use accepted snapshots and validated commands; opening a panel does not create membership. |
| Hosted admission | `app/api/world/join/route.ts`, `lib/world/hosted-ticket.ts`, `multiplayer/worker.ts` | Retain signed short-lived admission, single-use tickets, socket-owned identity and rate limits. |
| Player voice signaling | `multiplayer/player-voice.ts`, `lib/world/player-voice-contract.ts` | Opt-in, authoritative range/session checks and a bounded mutual peer graph, isolated from gameplay messages. |
| Player microphone and playback | `lib/voice/proximity.ts`, `lib/voice/push-to-talk.ts`, `components/game/proximity-voice.tsx`, `voice-welcome.tsx` | Explicit permission and push-to-talk, audio activity, lifecycle cleanup and the latest user preference. |
| Character speech presentation | `lib/world/scene.ts`, `lib/characters/avatar.ts`, `lib/characters/speaking-animation.ts` | Drive indicators from actual audio activity; preserve movement, riding and emotes. |
| Future NPC authorization/transcripts | `lib/world/voice-contract.ts` | `voiceAccess` derives the accepted encounter speaker; `AttributedTranscript` is a TypeScript shape, not an implemented stream or endpoint. |

The Node NPC prototype in the original authoring checkout is **not included here**. In particular, this release has no `npc-voice-service.ts`, `npc-voice.tsx`, `npc-audio.ts`, NPC capture worklet, `WORLD_DEPLOYMENT.md` or working partner audio endpoint. Do not import those paths or assume their custom PCM protocol is part of this release.

## Current player voice behavior

The hosted Worker relays signaling only; audio flows through browser WebRTC peers. An opted-in player can connect to at most seven peers within 12 metres in a 32-player room. The bounded graph preserves connections and rebalances isolated newcomers; it does not promise every nearby player is audible or that the whole room forms one conversation group. Non-opted-in clients do not receive unsolicited voice rosters.

The browser starts microphone tracks silent and enables transmission only while the talk control is held. Release, disable, focus loss and connection teardown stop transmission. Actual microphone or decoded remote audio activity drives the HUD and Talk animation. The gameplay transport exposes whether player voice is supported so unsupported local transports do not request a microphone or emit voice messages.

STUN discovery is configured. **TURN is not provisioned**, and decoded microphone audio between real computers on separate networks has not been verified. Local controller/signaling tests do not establish WAN connectivity, microphone quality or production capacity. Range-based signaling and the supplied client's media cleanup are not an SFU-enforced media boundary.

## Shared NPC encounter semantics

The room validates distance before admitting a learner to an NPC encounter. Any member may claim an available speaking turn; only the current `speakerId` may transmit future NPC input. `ownerId` does not grant exclusive speech. Leaving/disconnecting removes that learner, clears their speaking turn, transfers ownership to a remaining member if necessary and ends the encounter only when its last member leaves.

A future provider adapter must check `voiceAccess` against the current authoritative snapshot for every input stream or chunk. Stop capture/routing immediately when the speaking turn, membership or connection is lost. An ownership handoff must never carry forward a departed user's open microphone. The shared provider conversation may continue for remaining members under the same accepted encounter, with input authorized again for the next speaker. Close the provider session when the encounter ends.

NPC voice is currently unavailable in both the UI and hosted service. Claiming a turn changes shared game state; it does not open a GPT session or microphone. Do not replace these semantics with the older prototype's owner-only conversation rules without an explicit product decision and corresponding tests.

## Future GPT and HeyGen integration

Choose the actual provider API and whether HeyGen supplies audio, video or both before defining the adapter. This checkout implements no GPT/HeyGen SDK calls, endpoints, session negotiation or media format. Keep provider credentials on the service and introduce validated provider/session events deliberately.

Bind a provider session to authority-owned `roomId`, `encounterId`, `npcId` and `scenarioId`. Define Japanese persona/language instructions at the provider boundary. Keep HeyGen video as a separate presentation surface unless a deliberate 3D adapter is added. Play each NPC output once; avoid duplicate audio through both game playback and a video element. Cancel pending connections, queued playback and obsolete replies when the encounter ends. Keep player voice and NPC lesson input separately routed so the same utterance is not inadvertently sent to both.

## Lessons and assessment

Use `scenarioId` to select the lesson. Keep lesson content, attempt IDs and persisted results in the lesson service rather than broadcasting them in every movement snapshot. `AttributedTranscript` supplies room/encounter, speaker identity, text and audio timestamps; add validated events and storage when the transcript service exists.

Proposed additional identifiers are `lessonId`, `attemptId` and a stable learner account ID. These are not current API fields, and an ephemeral room guest ID is insufficient for durable learning history. Attribute contributions and feedback separately to each learner. Define completion and scoring with the lesson service; pressing Finish or closing a panel alone does not earn progress.

## Merge acceptance

Run from `web/`:

```sh
npm run test:world
npm run test:multiplayer
node scripts/prepare-rapier.mjs
node scripts/verify-player-voice.mjs
npx tsc --noEmit
npm run lint
npm run build
```

The combined release checkpoint passed 150 world/controller/asset tests, 14 Miniflare/workerd multiplayer checks and nine hosted player-voice checks. This includes the hosted-only voice capability regression checks. Preserve admission/replay, 32-player capacity, isolated-newcomer voice, legacy-client compatibility and shared-turn tests.

For the provider/lesson merge, verify two real clients can join the same room, open the accepted NPC scenario, alternate the exclusive speaking turn, transfer encounter ownership on departure and retain correct transcript attribution. Verify microphone release, opt-out, disconnect, provider failure/retry and final-member departure clean up resources without duplicate output. Recheck character editing, vehicles, emotes and both cameras after the lesson UI closes. Record real decoded microphone audio, separate-network connectivity and a TURN relay path separately when those services are available.
