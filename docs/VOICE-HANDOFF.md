# Alan → Ryan: Japanese-to-English voice integration

## Scope and ownership
Alan: backend session routes, provider configuration, translation prompt, client protocol adapter.
Ryan: frontend, 3D scene, LiveKit microphone publishing and remote media playback, Sites scaffold/deployment adapter.
One player first. Inworld is replaced by ElevenLabs. The avatar is an interpreter, not a barista answering questions.
Translation starts after short Japanese utterances; this is turn-based live interpretation, not guaranteed simultaneous translation.

## Provider setup (required before live testing)
1. Use a paid ElevenLabs account. The LiveAvatar ElevenLabs Agent Connector does not support free-tier API keys.
2. Create an ElevenLabs Agent. Paste `backend/prompts/japanese-to-english.txt` into its system prompt. Configure Japanese input recognition (test multilingual recognition if required by dashboard), your chosen ElevenLabs voice, and **PCM 24 kHz output**. Avoid an English-only recognition configuration. Disable the initial greeting if supported. Select an available agent LLM in ElevenLabs; voice synthesis alone does not translate.
3. Register the ElevenLabs API key as an `ELEVENLABS_API_KEY` secret in LiveAvatar. Required ElevenLabs key permissions: `convai_read`, `user_read`, `voices_read`. This intentionally lets LiveAvatar use the ElevenLabs account. Save the returned secret ID.
4. Select a LiveAvatar avatar and obtain the separate LiveAvatar API key.
5. Copy `backend/.env.example` to `backend/.env` and fill in values locally. Never paste keys into chat or commit them. Optional `ELEVENLABS_VOICE_ID` overrides the agent voice; using a stock voice is fine. No voice cloning is performed by this code.
6. Set a demo access code and exact frontend origin. Add matching server-side values in Sites settings when deploying. Never put provider keys in `VITE_*` variables.

## Local backend
Requires Node 22+. No npm dependencies.

```sh
cd backend
npm test
npm run dev
```

`GET /api/health` returns readiness without contacting paid services.
`POST /api/sessions` requires `X-Demo-Access-Code` (entered by the demo user). No body.
Response:

```json
{
  "sessionId": "...", "roomId": "...", "sessionToken": "...",
  "livekitUrl": "wss://...", "livekitClientToken": "...",
  "sourceLanguage": "ja", "targetLanguage": "en"
}
```

`POST /api/sessions/stop` requires the access-code header and `Authorization: Bearer <sessionToken>`.
Keep both returned tokens in memory only; do not log them or put them in URLs/local storage.
Sessions are capped at five minutes. The shared access code is demo protection, not production authentication or distributed rate limiting.

## Frontend connection sequence
1. Import helpers from `backend/src/client.mjs`. Call `startTranslationSession` on a user click. Disable Start until it settles so one click cannot create duplicate sessions.
2. Use `livekit-client` to connect a Room to `livekitUrl` with `livekitClientToken`.
3. Subscribe to remote audio/video tracks and attach them to your media elements. Play ONLY the avatar audio; the connector already consumes ElevenLabs audio. Handle browser autoplay on the user's Start click.
4. Publish microphone audio with echo cancellation. Start muted; enable while the talk button is held and disable on release. Also mute on pointer cancel/window blur. Provider VAD decides when the utterance ends; this is not an explicit commit protocol.
5. On LiveKit `DataReceived`, call `parseTranslationEvent(bytes, topic)`. Display `transcript` as Japanese and `translation` as English. Apply `translation_correction` to the latest English response. Do not also consume FULL-mode transcript events or subtitles will duplicate. Rapid overlapping turns and transcript pairing need live verification.
6. For typed fallback, publish `textTranslationCommand(japaneseText)` reliably on topic `agent-control`.
7. On Stop, stop microphone capture, call `stopTranslationSession`, and disconnect the room in a finally block. If connecting the room fails after session creation, still stop the backend session. Handle remote `session_stopped` by releasing media tracks and resetting UI. A closed tab may miss cleanup; the duration cap limits orphan sessions.

## Sites
Mount `createHandler(env)` from `backend/src/handler.mjs` under the starter's `/api/*` routes. Forward the original Request and return its Response. Keep the handler instance/config server-side. The Node HTTP dev server is LOCAL ONLY; do not assume Sites runs a persistent Node process. Ryan owns the concrete Sites route wrapper once the starter is available.

The connector carries voice/media through its managed LiveKit room. This app backend only makes HTTPS calls to create/start/stop sessions. No custom audio WebSocket relay or database is needed for this milestone. `roomId` reserves a future shared-session concept; multiplayer is not implemented.

## Verification still required
Actual keys and agent setup are not yet supplied. Tests mock provider HTTP responses; they do not prove speech recognition, translation accuracy, lip sync, account permissions, or Sites compatibility.
Test these live, checking meaning rather than exact wording:
- コーヒーを一杯ください。 → One coffee, please.
- ミルクなしでお願いします。 → No milk, please. (preserve negation)
- アイスラテを二つください。 → Two iced lattes, please. (preserve quantity)
- これはいくらですか？ → How much is this? (translate; do not answer)
Run three complete sessions and verify Stop releases audio/video each time.

## Official references
- https://docs.liveavatar.com/docs/elevenlabs-agent-plugin.md
- https://docs.liveavatar.com/api-reference/sessions/create-session-token.md
- https://docs.liveavatar.com/api-reference/sessions/start-session.md
- https://docs.liveavatar.com/api-reference/sessions/stop-session.md
- https://elevenlabs.io/docs/eleven-agents/api-reference/eleven-agents/websocket
