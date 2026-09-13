// Protocol adapted from HeyGen's MIT-licensed liveavatar-gpt-live-demos.
// See ../../lib/lesson/HEYGEN-LICENSE.txt.
import WebSocket from 'ws';
import { TurnProjector } from './turns';
import type { Feedback, NativeLanguage, Question, Scenario, Turn } from '../../lib/lesson/types';

const MAX_BUFFER = 2 * 1024 * 1024;
async function avatarPost(path: string, body: object, token?: string) {
  const response = await fetch(`https://api.liveavatar.com/v1/sessions/${path}`, {
    method: 'POST', signal: AbortSignal.timeout(20000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { 'X-API-KEY': process.env.LIVEAVATAR_API_KEY! }) },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`HeyGen could not ${path === 'token' ? 'create' : path} the avatar session (${response.status}). Check your LiveAvatar key, avatar and credits.`);
  return (await response.json() as { data: Record<string, string> }).data;
}

export interface LiveSink {
  avatar(url: string, token: string): void;
  ready(): void;
  turn(turn: Turn): void;
  failed(message: string): void;
}

/** One GPT-Live stream drives one LITE avatar. Only room credentials reach the browser. */
export class LiveBridge {
  private gpt?: WebSocket;
  private media?: WebSocket;
  private avatarId?: string;
  private closed = false;
  private gptReady = false;
  private mediaReady = false;
  private browserReady = false;
  private started = false;
  private readyTimer?: NodeJS.Timeout;
  private lifetime?: NodeJS.Timeout;
  private sequence = 0;
  private current: Question;
  private turns: TurnProjector;

  constructor(private scenario: Scenario, private language: NativeLanguage, question: Question, private sink: LiveSink) {
    this.current = question;
    this.turns = new TurnProjector({ onTurn: turn => sink.turn(turn), onUserTurnStarted: () => {
      // Discard queued avatar speech when the learner starts speaking.
      if (this.mediaReady) this.send(this.media, { type: 'agent.interrupt' });
    } });
  }
  private send(ws: WebSocket | undefined, event: object) {
    if (this.closed || ws?.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFER) { this.fail('The live connection is too slow. Reconnect to resume.'); return; }
    ws.send(JSON.stringify(event));
  }
  private fail(message: string) {
    if (this.closed) return;
    this.sink.failed(message);
    void this.close();
  }
  async start() {
    this.readyTimer = setTimeout(() => this.fail('The avatar took too long to connect. Please try again.'), 45000);
    try {
      const token = await avatarPost('token', { mode: 'LITE', avatar_id: process.env.LIVEAVATAR_AVATAR_ID });
      this.avatarId = token.session_id;
      if (!this.avatarId || !token.session_token) throw new Error('HeyGen did not return a session token.');
      if (this.closed) { await this.stopAvatar(); return; }
      const session = await avatarPost('start', {}, token.session_token);
      // A close may have already stopped the token while start was in flight.
      if (this.closed) { await avatarPost('stop', { session_id: token.session_id }).catch(() => {}); return; }
      if (!session.ws_url || !session.livekit_url || !session.livekit_client_token) throw new Error('HeyGen did not return the LITE media connection.');
      this.media = new WebSocket(session.ws_url, { maxPayload: MAX_BUFFER });
      this.media.on('message', raw => {
        try {
          const event = JSON.parse(raw.toString());
          if (event.type === 'session.state_updated' && event.state === 'connected') { this.mediaReady = true; this.maybeReady(); }
          if (event.type === 'error' || event.type === 'session.error') this.fail('The avatar media connection failed. Please reconnect.');
        } catch { this.fail('The avatar returned an unreadable message.'); }
      });
      this.media.on('error', () => this.fail('The avatar media connection could not open.'));
      this.media.on('close', () => this.fail('The avatar disconnected. You can keep practising with text.'));
      this.sink.avatar(session.livekit_url, session.livekit_client_token);
      this.gpt = new WebSocket('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, maxPayload: 8 * 1024 * 1024 });
      this.gpt.on('open', () => this.send(this.gpt, { type: 'session.start', event_id: 'start', session: {
        model: 'gpt-live-1',
        instructions: `You are ${this.scenario.name}, a kind Japanese tutor in a ${this.scenario.title} roleplay. Speak natural, slow beginner Japanese only. Understand English and ${this.language}. Ask only the current app question; do not advance until the app sends a new one. Respond to every learner answer: affirm correct meaning or gently correct one real mistake, then model a natural Japanese phrase. Native-language answers are allowed. Accept valid Japanese alternatives, and never invent errors. Detailed written feedback appears in the app. Keep replies to one or two short sentences and let the learner retry. Initial question: ${this.current.japanese}`,
        audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: 'marin' } },
      } }));
      this.gpt.on('message', raw => {
        try {
          const event = JSON.parse(raw.toString());
          if (event.type === 'session.started') { this.gptReady = true; this.maybeReady(); }
          if (event.type === 'session.output_audio.delta' && this.mediaReady && typeof event.delta === 'string') {
            // A continuous stream: GPT-Live has no audio-done event. Do not send agent.speak_end per turn.
            this.send(this.media, { type: 'agent.speak', audio: event.delta });
          }
          if (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta') {
            this.turns.fragment(event.type === 'session.input_transcript.delta' ? 'user' : 'assistant', event.delta || '', typeof event.start_ms === 'number' ? event.start_ms : null, typeof event.end_ms === 'number' ? event.end_ms : null);
          }
          if (event.type === 'session.delegation.created' && event.delegation_id) this.append('instructions', 'Continue the current Japanese practice using the current lesson question. Written assessment is handled by the app.', event.delegation_id);
          if (event.type === 'error') this.fail('GPT-Live could not continue. Check model access and API credits, then reconnect.');
          if (event.type === 'session.closed') this.gpt?.close();
        } catch { this.fail('The voice service returned an unreadable message.'); }
      });
      this.gpt.on('error', () => this.fail('GPT-Live could not connect. Check model access and API credits.'));
      this.gpt.on('close', () => this.fail('The voice session ended. You can keep practising with text.'));
      this.lifetime = setTimeout(() => this.fail('This five-minute avatar session has ended. Start another to continue.'), 5 * 60 * 1000);
    } catch (error) { this.fail(error instanceof Error ? error.message : 'The live session could not start.'); }
  }
  avatarReady() { this.browserReady = true; this.maybeReady(); }
  private maybeReady() {
    if (this.closed || this.started || !this.gptReady || !this.mediaReady || !this.browserReady) return;
    this.started = true;
    clearTimeout(this.readyTimer);
    this.sink.ready();
    this.ask(this.current);
  }
  audio(audio: string) { if (this.started) this.send(this.gpt, { type: 'session.input_audio.append', audio }); }
  private append(kind: 'instructions' | 'thinking', content: string, delegationId: string | null = null) {
    if (this.gptReady) this.send(this.gpt, { type: `session.${kind}.append`, event_id: `lesson_${++this.sequence}`, delegation_id: delegationId, content });
  }
  ask(question: Question) {
    this.current = question;
    if (!this.started) return;
    this.send(this.media, { type: 'agent.interrupt' });
    this.append('instructions', `The app's current question is now: ${question.japanese} Learner task: ${question.task} Ask that question in Japanese now. Wait for their answer; do not ask the next question.`);
  }
  feedback(feedback: Feedback) {
    this.append('thinking', `App assessment: ${JSON.stringify({ verdict: feedback.verdict, naturalJapanese: feedback.japanese, meaning: feedback.meaning })}`.slice(0, 800));
    this.append('instructions', `Briefly model this correct Japanese phrase now: ${feedback.japanese}. Encourage the learner to repeat it; stay on the current question.`);
  }
  async close() {
    if (this.closed) return;
    this.closed = true;
    clearTimeout(this.readyTimer); clearTimeout(this.lifetime); this.turns.dispose();
    if (this.gpt?.readyState === WebSocket.OPEN) {
      this.gpt.send(JSON.stringify({ type: 'session.close', event_id: 'close' }));
      const socket = this.gpt;
      const drain = setTimeout(() => socket.terminate(), 3000);
      socket.once('close', () => clearTimeout(drain));
    } else this.gpt?.terminate();
    this.media?.terminate();
    await this.stopAvatar();
  }
  private async stopAvatar() {
    const id = this.avatarId;
    this.avatarId = undefined;
    if (id) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await avatarPost('stop', { session_id: id }); return; }
        catch { if (attempt === 1) console.warn('HeyGen session cleanup was not confirmed. Check active sessions in LiveAvatar.'); }
      }
    }
  }
}
