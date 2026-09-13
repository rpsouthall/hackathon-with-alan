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
  return new TextEncoder().encode(JSON.stringify({
    event_type: 'elevenlabs_agent_command', elevenlabs_event_type: 'user_message', data: { text: text.trim() },
  }));
}
// Consume only raw passthrough transcripts, not both wrapper and FULL-mode duplicates.
export function parseTranslationEvent(bytes, topic) {
  if (topic !== 'agent-response') return null;
  let event;
  try { event = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!event || typeof event !== 'object') return null;
  if (event.event_type === 'session_stopped') return { type: 'session_stopped' };
  if (event.event_type !== 'elevenlabs_agent_event') return null;
  const data = event.data;
  if (event.elevenlabs_event_type === 'user_transcript') {
    const text = data?.user_transcription_event?.user_transcript;
    return typeof text === 'string' ? { type: 'transcript', language: 'ja', text } : null;
  }
  if (event.elevenlabs_event_type === 'agent_response') {
    const text = data?.agent_response_event?.agent_response;
    return typeof text === 'string' ? { type: 'translation', language: 'en', text } : null;
  }
  if (event.elevenlabs_event_type === 'agent_response_correction') {
    const text = data?.agent_response_correction_event?.corrected_agent_response;
    return typeof text === 'string' ? { type: 'translation_correction', language: 'en', text } : null;
  }
  return null;
}
