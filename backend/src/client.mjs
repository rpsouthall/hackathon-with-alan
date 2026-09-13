// Browser-safe integration helpers. Ryan owns LiveKit connection, microphone and media rendering.
export async function startTranslationSession({ baseUrl = '', accessCode, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/sessions`, {
    method: 'POST', headers: { 'X-Demo-Access-Code': accessCode },
  });
  if (!response.ok) throw new Error('Unable to start translation session');
  return response.json();
}
export async function stopTranslationSession({ baseUrl = '', accessCode, sessionToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`${baseUrl}/api/sessions/stop`, {
    method: 'POST', headers: { 'X-Demo-Access-Code': accessCode, Authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) throw new Error('Unable to stop translation session');
}
export function textTranslationCommand(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('Enter 1–2000 characters');
  return JSON.stringify({ type: 'text', text: text.trim() });
}
// Send these commands to the avatar WebSocket AFTER its connected event.
// Play only LiveKit avatar audio, not Inworld audio a second time.
export function avatarCommand(event) {
  if (event?.type === 'response.output_audio.delta') return { type: 'agent.speak', audio: event.delta };
  if (event?.type === 'response.output_audio.done') return { type: 'agent.speak_end' };
  if (event?.type === 'input_audio_buffer.speech_started') return { type: 'agent.interrupt' };
  return null;
}
export function parseTranslationEvent(event) {
  if (event?.type === 'conversation.item.input_audio_transcription.completed') return { type: 'transcript', language: 'ja', text: event.transcript, utteranceId: event.item_id };
  if (event?.type === 'response.output_audio_transcript.delta') return { type: 'translation_delta', language: 'en', text: event.delta, responseId: event.response_id };
  return null;
}
