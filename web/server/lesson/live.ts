// Protocol adapted from HeyGen's MIT-licensed liveavatar-gpt-live-demos.
// See ../../lib/lesson/HEYGEN-LICENSE.txt.
import type { LessonSocket, SocketFactory } from './socket';
import type { LessonRuntime } from './runtime';
import { tutorInstructions, tutorQuestion, tutorFeedback } from './tutor-prompts';
import { TurnProjector } from './turns';
import { voiceForAvatar } from '../../lib/lesson/characters';
import type { Feedback, NativeLanguage, Question, Scenario, Turn } from '../../lib/lesson/types';

const MAX_BUFFER = 2 * 1024 * 1024;
async function avatarPost(runtime: LessonRuntime, path: string, body: object, token?: string) {
  const response = await fetch(`https://api.liveavatar.com/v1/sessions/${path}`, {
    method: 'POST', signal: AbortSignal.timeout(path === 'stop' ? 8000 : 20000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : { 'X-API-KEY': runtime.LIVEAVATAR_API_KEY! }) },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    // Never expose provider bodies or assume that every 403 means no credit.
    const error = await response.json().catch(() => null) as { code?: unknown; message?: unknown; error?: { code?: unknown; message?: unknown } } | null;
    const fields = [error?.code, error?.message, error?.error?.code, error?.error?.message];
    const noCredits = fields.some(value => typeof value === 'string' && /(?:insufficient[ _-]+credits?|not enough credits?|credits?[ _-]+(?:exhausted|depleted)|no credits? remaining)/i.test(value));
    if (noCredits) throw new Error('HeyGen credits are exhausted. Add LiveAvatar credits to start the avatar, or keep practising with text.');
    throw new Error(`HeyGen could not ${path === 'token' ? 'create' : path} the avatar session (${response.status}). Check your LiveAvatar key, avatar and credits.`);
  }
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
  private gpt?: LessonSocket;
  private media?: LessonSocket;
  private avatarId?: string;
  private closed = false;
  private startPromise?: Promise<void>;
  private closePromise?: Promise<void>;
  private gptReady = false;
  private mediaReady = false;
  private browserReady = false;
  private started = false;
  private readyTimer?: NodeJS.Timeout;
  private lifetime?: NodeJS.Timeout;
  private sequence = 0;
  private pendingSpeech: string | null = null;
  private current: Question;
  private turns: TurnProjector;

  constructor(private scenario: Scenario, private language: NativeLanguage, question: Question, private sink: LiveSink, private configuredAvatarId = process.env.LIVEAVATAR_AVATAR_ID, private connect: SocketFactory = () => { throw new Error('Live socket adapter is not configured.'); }, private runtime: LessonRuntime = process.env) {
    this.current = question;
    this.turns = new TurnProjector({ onTurn: turn => sink.turn(turn), onUserTurnStarted: () => {
      // Discard queued avatar speech when the learner starts speaking.
      if (this.mediaReady) this.send(this.media, { type: 'agent.interrupt' });
    } });
  }
  private send(ws: LessonSocket | undefined, event: object) {
    if (this.closed || ws?.readyState !== 1) return;
    if (ws.bufferedAmount > MAX_BUFFER) { this.fail('The live connection is too slow. Reconnect to resume.'); return; }
    ws.send(JSON.stringify(event));
  }
  private fail(message: string) {
    if (this.closed) return;
    this.sink.failed(message);
    void this.close();
  }
  start(): Promise<void> {
    if (this.closed) return Promise.resolve();
    return this.startPromise ??= this.open();
  }
  private async open() {
    this.readyTimer = setTimeout(() => this.fail('The avatar took too long to connect. Please try again.'), 45000);
    try {
      // Voice and avatar provisioning are independent; overlap their startup.
      this.gpt = this.connect('wss://api.openai.com/v1/live/sessions', { headers: { Authorization: `Bearer ${this.runtime.OPENAI_API_KEY}` }, maxPayload: 8 * 1024 * 1024 });
      this.gpt.on('open', () => this.send(this.gpt, { type: 'session.start', event_id: 'start', session: {
        model: 'gpt-live-1',
        instructions: tutorInstructions(this.scenario, this.language),
        audio: { format: { type: 'audio/pcm', rate: 24000 }, output: { voice: voiceForAvatar(this.configuredAvatarId) } },
      } }));
      this.gpt.on('message', raw => {
        try {
          const event = JSON.parse(raw.toString());
          if (event.type === 'session.started') { this.gptReady = true; this.maybeReady(); }
          if (event.type === 'session.output_audio.delta' && this.started && typeof event.delta === 'string') {
            // A continuous stream: GPT-Live has no audio-done event. Do not send agent.speak_end per turn.
            this.send(this.media, { type: 'agent.speak', audio: event.delta });
          }
          if (this.started && (event.type === 'session.input_transcript.delta' || event.type === 'session.output_transcript.delta')) {
            this.turns.fragment(event.type === 'session.input_transcript.delta' ? 'user' : 'assistant', event.delta || '', typeof event.start_ms === 'number' ? event.start_ms : null, typeof event.end_ms === 'number' ? event.end_ms : null);
          }
          if (event.type === 'session.delegation.created' && event.delegation?.target === 'client' && typeof event.delegation.id === 'string') this.append('commentary', tutorQuestion(this.current), event.delegation.id);
          if (event.type === 'session.instructions.appended' && event.client_event_id === this.pendingSpeech) {
            this.pendingSpeech = null;
            this.append('commentary', 'Follow the current task instructions and speak now.');
          }
          if (event.type === 'error') this.fail('GPT-Live could not continue. Check model access and API credits, then reconnect.');
          if (event.type === 'session.closed') this.gpt?.close();
        } catch { this.fail('The voice service returned an unreadable message.'); }
      });
      this.gpt.on('error', cause => {
        const status = cause instanceof Error ? cause.message.match(/\(HTTP \d{3}\)/)?.[0] : undefined;
        this.fail(`GPT-Live could not connect${status ? ` ${status}` : ''}. Please reconnect.`);
      });
      this.gpt.on('close', () => this.fail('The voice session ended. You can keep practising with text.'));
      const token = await avatarPost(this.runtime, 'token', { mode: 'LITE', avatar_id: this.configuredAvatarId });
      this.avatarId = token.session_id;
      if (!this.avatarId || !token.session_token) throw new Error('HeyGen did not return a session token.');
      if (this.closed) return;
      const session = await avatarPost(this.runtime, 'start', {}, token.session_token);
      // A close may have already stopped the token while start was in flight.
      if (this.closed) return;
      if (!session.ws_url || !session.livekit_url || !session.livekit_client_token) throw new Error('HeyGen did not return the LITE media connection.');
      this.media = this.connect(session.ws_url, { maxPayload: MAX_BUFFER });
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
  private append(kind: 'instructions' | 'thinking' | 'commentary', content: string, delegationId: string | null = null) {
    const id = `lesson_${++this.sequence}`;
    if (this.gptReady) this.send(this.gpt, { type: `session.${kind}.append`, event_id: id, delegation_id: delegationId, content });
    return id;
  }
  ask(question: Question) {
    this.current = question;
    if (!this.started) return;
    this.send(this.media, { type: 'agent.interrupt' });
    this.pendingSpeech = this.append('instructions', tutorQuestion(question));
  }
  feedback(feedback: Feedback) {
    this.send(this.media, { type: 'agent.interrupt' });
    this.pendingSpeech = this.append('instructions', tutorFeedback(feedback));
  }
  close(): Promise<void> {
    return this.closePromise ??= this.dispose();
  }
  private async dispose() {
    this.closed = true;
    clearTimeout(this.readyTimer); clearTimeout(this.lifetime); this.turns.dispose();
    if (this.gpt?.readyState === 1) {
      this.gpt.send(JSON.stringify({ type: 'session.close', event_id: 'close' }));
      const socket = this.gpt;
      const drain = setTimeout(() => socket.terminate(), 3000);
      socket.once('close', () => clearTimeout(drain));
    } else this.gpt?.terminate();
    this.media?.terminate();
    // Token/start responses may arrive after the player leaves. Wait for the
    // opening operation so its eventual session ID is also stopped.
    await this.startPromise;
    await this.stopAvatar();
  }
  private async stopAvatar() {
    const id = this.avatarId;
    this.avatarId = undefined;
    if (id) {
      for (let attempt = 0; attempt < 2; attempt++) {
        try { await avatarPost(this.runtime, 'stop', { session_id: id }); return; }
        catch { if (attempt === 1) console.warn('HeyGen session cleanup was not confirmed. Check active sessions in LiveAvatar.'); }
      }
    }
  }
}
