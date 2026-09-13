# Inworld + HeyGen: Alan → Ryan

Alan owns backend/voice; Ryan owns frontend/3D and Sites integration.
ElevenLabs has been replaced. No ElevenLabs account, agent ID, or secret is needed.

## Setup
1. In https://platform.inworld.ai open Settings → API Keys. Copy the Base64 credential into INWORLD_API_KEY in backend/.env, using backend/.env.example as the template. Never paste credentials into chat or source code.
2. Configure a LiveAvatar API key and avatar ID separately. Inworld credits do not cover HeyGen charges. Inworld Realtime/STT/LLM access and credit applicability must be verified on the account.
3. Set DEMO_ACCESS_CODE and ALLOWED_ORIGIN to Ryan's exact frontend origin.
4. Run `cd backend && npm install && npm test && npm run dev`.

No separate Inworld dashboard agent is required by this implementation. The server sets the Japanese-to-English interpreter prompt from backend/prompts/japanese-to-english.txt. Default voice is Clive, configurable in INWORLD_VOICE. No voice cloning is performed. Translation uses an LLM through Inworld, not voice synthesis alone.

## HTTP contract
GET /api/health returns configuration readiness, not live provider validation.
POST /api/sessions requires X-Demo-Access-Code; no body. Returns sessionId, roomId, sessionToken, livekitUrl, livekitClientToken, avatarWebsocketUrl, sourceLanguage=ja, targetLanguage=en.
POST /api/sessions/stop requires X-Demo-Access-Code and Authorization: Bearer <sessionToken>.
Keep session credentials in memory, never URLs/logs/local storage. Session creation must be guarded against duplicate clicks. Five-minute cap. The access code is demo protection, not production authentication/rate limiting.

## Browser sequence (changed from ElevenLabs)
1. Create the HeyGen session through HTTP. Connect LiveKit with returned browser credentials and subscribe to avatar audio/video. Do NOT publish the microphone to LiveKit.
2. Connect avatarWebsocketUrl. Wait for `session.state_updated` with state `connected` before any audio command. Only one avatar WebSocket per session is allowed.
3. Connect the backend /api/voice WebSocket (ws locally, wss deployed). First frame: {"type":"auth","accessCode":"<entered demo code>"}. Wait for `voice.ready` before enabling microphone input. No API key is sent to the browser.
4. Send microphone PCM16 little-endian, 24 kHz, mono, base64 in {"type":"audio","audio":"..."}; use 60–100ms chunks. Ensure actual resampling to 24 kHz, not just a requested microphone constraint. The initial implementation uses VAD to complete turns; after releasing push-to-talk keep sending silence until the VAD turn ends. No explicit commit message is implemented.
5. For each Inworld event use avatarCommand from backend/src/client.mjs and forward resulting JSON to the ready avatar WebSocket. Output audio chunks → agent.speak; output audio done → agent.speak_end; speech started → agent.interrupt. Consider coalescing chunks toward HeyGen's recommended ~1 second size after live testing; flush pending chunks on end and discard on interruption. Play ONLY LiveKit avatar audio, never Inworld audio separately.
6. Use parseTranslationEvent for Japanese transcript and English translation deltas. Append deltas grouped by responseId. Typed fallback: send textTranslationCommand(text) to /api/voice. Do NOT use the previous ElevenLabs LiveKit data-channel commands.
7. Stop and all failure paths: close the voice WebSocket, stop microphone tracks, call /api/sessions/stop, close avatar WebSocket, disconnect LiveKit. Closing the voice socket releases Inworld. Stopping HTTP alone releases only HeyGen. Handle response.done failure status, both provider errors, and socket closures in UI. Close any already-created session when a later connection step fails.

## Deployment
HTTP Fetch handler remains backend/src/handler.mjs. The Inworld relay uses Node + ws in backend/src/inworld.mjs, attached by the local dev server. Ryan must verify/adapt WebSocket upgrade handling for the actual Sites runtime; a standard Fetch route alone does not mount this relay. Do not claim deployed compatibility until this has been tested. A separately hosted voice relay remains a fallback.

## Verification status
Unit tests use mocked HTTP and protocol events. No live credentials used; recognition, translation, lip sync, account access, relay connection behaviour under load, and Sites hosting are unverified. Dependency installation must complete before starting the relay.
Test: コーヒーを一杯ください。 / ミルクなしでお願いします。 / アイスラテを二つください。 / これはいくらですか？ Preserve negation, quantities, and questions; translate rather than answer. Run three sessions and verify Stop releases both services.

Official references:
- https://docs.inworld.ai/realtime/connect/websocket
- https://docs.inworld.ai/realtime/quickstart-websocket
- https://docs.liveavatar.com/docs/lite-mode/events
