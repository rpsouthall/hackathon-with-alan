# Japanese lesson and LiveAvatar companion

The game opens a ten-question lesson when a player approaches a supported NPC and presses E. With credentials configured, each new encounter automatically starts its assigned live avatar and a fresh private chat. `/lesson-lab` opens any of the three lessons directly. Questions and translations live in `lib/lesson/scenarios.ts`.

## Run locally

From `web`, start the lesson companion and the existing frontend in separate terminals:

```sh
# Existing Alan checkout: reuse the key already saved in this ignored file.
node --env-file=../../hackathon-with-alan/backend/.env --import tsx server/lesson/run.ts
npm run dev
```

For another developer, create a private, ignored `web/.env.lesson` instead, then run:

```sh
node --env-file=.env.lesson --import tsx server/lesson/run.ts
```

Environment variables (never prefix keys with VITE_ or commit them):

| Variable | Purpose |
| --- | --- |
| `OPENAI_API_KEY` | GPT-Live microphone conversation and Responses written feedback |
| `LIVEAVATAR_API_KEY` | HeyGen LiveAvatar API key, separate from OpenAI credits |
| `LIVEAVATAR_AVATAR_ID` | Selected LiveAvatar public or custom avatar ID |
| `LESSON_ASSESSMENT_MODEL` | Optional; defaults to `gpt-5.6-luna` |
| `LESSON_PORT` | Optional; defaults to 8790; also update the Vite proxy if changed |
| `LESSON_ALLOWED_ORIGINS` | Exact comma-separated local preview origins; defaults to localhost:5173 and 127.0.0.1:5173 |

The frontend proxies HTTP `/lesson-api` to `127.0.0.1:8790`. Local browser websockets connect directly to that loopback companion because the Cloudflare/Vinext preview also installs upgrade handlers. If changing the port, update both the Vite proxy and local socket URL in `lesson-dialogue.tsx`. Without HeyGen configuration, typed AI feedback and locally assessed choice quizzes work. Without the companion, the screen can display questions, hints, and choice-quiz feedback; roleplay assessment remains unavailable. API calls happen when the user submits an answer or starts the live avatar.

## Connection and lesson behavior

- Avatar video starts independently of microphone setup. A permission or autoplay restriction offers Enable microphone / Enable sound while text chat stays usable. Browser microphone: continuous mono PCM16, 24kHz, sent in 100ms frames over the local lesson websocket.
- Server: GPT-Live at `/v1/live/sessions`, model `gpt-live-1`; `session.start`, then audio after `session.started` and both avatar legs are ready.
- HeyGen: a LITE session renders the continuous GPT audio via `agent.speak`; no fabricated per-turn `speak_end`. The browser receives only LiveKit viewer credentials. API keys, the session token, and media websocket URL stay on the server.
- The server owns progress. A learner reviews feedback before proceeding, can retry, and receives a phrase recap after ten questions. Choices are deterministic. Typed and transcribed answers receive schema-validated AI feedback. Valid native-language answers are accepted; Japanese attempts receive one concrete correction where needed. No pronunciation score is inferred from text.
- Transcripts use a 1.5-second quiet gap to estimate finished speech. Long pauses may split an answer; learners can retry or type the intended sentence. GPT-Live itself still controls speech turn-taking.
- Microphone and media tracks stop on exit, Stop, failure, or disconnect. New encounters use a stable per-tab client ID to replace only their own previous session; a serialized slot waits for provider teardown before creating another. Cancellation during token creation/start waits for the late provider response and stops that session. Old connection callbacks cannot clear a newer video stream. The server caps one live avatar at a time and five minutes per session, sends session stop to HeyGen, bounds payloads, restricts origins, and cancels in-flight grading on disconnect. Failed cleanup is logged without credentials.

## Validation and deployment

Run `npm run test:lesson`, `npm run test:world`, and `npx tsc --noEmit`. Unit and integration checks do not require paid API calls. To verify the live connection, configure the keys and ID, open a lesson, confirm the avatar starts automatically, allow microphone access if requested, answer the current task in English, check Japanese speech and written feedback, try Japanese, then leave and check that the microphone stops.

This companion binds to loopback for local hackathon testing. It is **not deployed** with the Sites static/frontend build. Before publishing, host/adapt the websocket companion in a suitable runtime and add authenticated session ownership, per-user usage limits, allowed deployed origins, and production secret configuration. Shared-world speaking-turn authority is not wired to this service: each player has a private avatar and chat, including in a shared world. The local companion currently allows one paid live session at a time. Another player receives a clear busy message rather than having their session interrupted. World NPC identities and avatar IDs are validated against lib/lesson/characters.ts; the browser cannot supply an arbitrary paid avatar ID. The lesson lab uses the configured fallback avatar when no world character is selected.

Protocol reference: [HeyGen GPT-Live demos](https://github.com/heygen-com/liveavatar-gpt-live-demos). Adapted microphone, turn-projection, and avatar transport code retains the MIT license in `lib/lesson/HEYGEN-LICENSE.txt`.
