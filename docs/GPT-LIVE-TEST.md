# Aiko live Japanese conversation

Alan owns voice/backend; Ryan owns the game shell and NPCs. The current provider
is OpenAI GPT-Live 1. The standalone test connects a real microphone to the model
over WebRTC and plays the model's voice through a browser audio element.
HeyGen video is not connected to this test.

Validated locally on 13 September 2026: all 17 backend tests passed. A short real
GPT-Live WebSocket smoke test using synthetic silence produced Japanese audio and
the transcript `いらっしゃいませ。何になさいますか?`, then emitted `session.closed`
with 11 seconds of reported session usage. This confirms API access and generated
speech; browser microphone capture, WebRTC playback and NPC integration still
need hands-on verification.

Follow-up browser check: replaced a strict ICE-gathering timeout with a short
candidate-gathering window. The Codex browser then reached `session.started`
with its microphone and remote audio track, and displayed Aiko's Japanese
greeting in live captions. All 20 backend/connection tests passed. The user
should still confirm audible playback and a spoken two-way exchange.

## Run locally

Use Node 22 or newer. Put `OPENAI_API_KEY` in the ignored `backend/.env` file.
Never put the key in frontend code, Vite variables, screenshots or Git.

```sh
cd backend
npm ci
npm test
npm run dev:live
```

Open http://localhost:8787/ in a browser, start the conversation, and allow the
microphone. The existing game preview can continue running on port 5173.
API credits are used only after the connection offer is submitted. Each test
targets a two-minute limit; keep the server running so its cleanup timer works.
If cleanup fails, the UI reports that shutdown is unconfirmed.

Try these in order:

1. Wait for Aiko's Japanese greeting.
2. Say `こんにちは。おすすめのお茶は何ですか？` (Which tea do you recommend?)
3. Say `抹茶を一つください。` (One matcha, please.)
4. Ask `いくらですか？` (How much is it?) — the scene menu says 500 yen.
5. Mute/unmute, try interrupting politely, then end the conversation.

Check that responses follow what you said, remain in Japanese, the captions
arrive, and the microphone indicator turns off when the session ends.
Captions display exact transcript fragments; they are not finalized utterances
or English translations. Headphones help prevent feedback.

## Integration after Ryan pushes NPCs

1. Start one voice session when the player enters dialogue with an NPC and enables
   their microphone. Supply the selected NPC's trusted scene/personality from
   server configuration; this test currently supports only Aiko.
2. Mount the remote audio in the dialogue panel and send transcript fragments to
   its caption UI. Disable game movement controls while dialogue owns focus.
3. End the session when leaving dialogue, changing NPCs, or leaving the page.
   Keep the connection alive until `session.closed`, with a timeout and server
   cleanup fallback. Do not let room spectators create duplicate paid sessions.
4. Add HeyGen video once voice works. Investigate GPT-Live sideband reflected
   audio and LiveAvatar LITE streaming for lip sync, buffering, and interruptions.
   The old Inworld `response.output_audio.done` adapter cannot be reused unchanged:
   GPT-Live uses timestamped continuous audio. Avoid playing both audio streams.
5. Move the session routes into the deployed application's server runtime with
   platform secrets, user authorization, usage limits and session ownership.
   This Node server intentionally accepts only localhost:8787 and is not a
   production or Sites deployment adapter.

## Protocol references

- [GPT-Live WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc?api=live)
- [Session controls and sideband audio](https://developers.openai.com/api/docs/guides/voice-server-controls?api=live)
- [Conversation events and graceful close](https://developers.openai.com/api/docs/guides/live-conversations)

The backend sends fixed model/personality configuration to `POST /v1/live/sessions`.
The browser receives an SDP answer and an opaque local stop ticket. Credentials
stay on the backend. The WebRTC data channel receives `session.started` and
transcript deltas; it must not send `session.start`. A backend sideband sends
`session.close` if the browser disconnects or the server timer expires.
