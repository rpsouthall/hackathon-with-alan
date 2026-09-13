import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { LessonEngine, gradeChoice } from '../../lib/lesson/engine';
import { scenarios } from '../../lib/lesson/scenarios';
import type { LessonEvent, NativeLanguage } from '../../lib/lesson/types';
import { assessAnswer } from './assess';
import { LiveBridge } from './live';
import { LiveSessionSlot } from './live-slot';
import { lessonCharacterForWorldNpc, scenarioForCharacter } from '../../lib/lesson/characters';

const language = z.enum(['English', 'Mandarin Chinese', 'Spanish', 'Japanese']);
const command = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start'), scenarioId: z.string().max(40), language, clientId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).optional(), characterId: z.string().max(80).optional() }),
  z.object({ type: z.literal('language'), language }),
  z.object({ type: z.literal('answer'), questionId: z.string().max(50), answer: z.string().trim().min(1).max(1500).optional(), choice: z.number().int().min(0).max(9).optional() }),
  z.object({ type: z.literal('next'), questionId: z.string().max(50) }),
  z.object({ type: z.literal('retry'), questionId: z.string().max(50) }),
  z.object({ type: z.literal('live') }), z.object({ type: z.literal('avatar-ready') }),
  z.object({ type: z.literal('stop-live') }),
  z.object({ type: z.literal('audio'), audio: z.string().max(16000).regex(/^[A-Za-z0-9+/]+={0,2}$/) }),
]);

export const capabilities = () => ({
  aiFeedback: !!process.env.OPENAI_API_KEY,
  liveAvatar: !!(process.env.OPENAI_API_KEY && process.env.LIVEAVATAR_API_KEY && process.env.LIVEAVATAR_AVATAR_ID),
  missing: ['OPENAI_API_KEY', 'LIVEAVATAR_API_KEY', 'LIVEAVATAR_AVATAR_ID'].filter(key => !process.env[key]),
});

/** Local-only companion. Production needs authenticated websocket hosting. */
export function createLessonServer(options: { createBridge?: (...args: ConstructorParameters<typeof LiveBridge>) => Pick<LiveBridge, 'start' | 'close' | 'audio' | 'ask' | 'feedback' | 'avatarReady'> } = {}) {
  const createBridge = options.createBridge ?? ((...args: ConstructorParameters<typeof LiveBridge>) => new LiveBridge(...args));
  type Bridge = ReturnType<typeof createBridge>;
  const allowedOrigins = new Set((process.env.LESSON_ALLOWED_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(','));
  const server = createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'GET' && req.url === '/lesson-api/config') {
      res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(capabilities()));
    } else { res.writeHead(404); res.end(); }
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 24 * 1024 });
  const liveSlot = new LiveSessionSlot<Bridge>();
  server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/lesson-api/session' || !allowedOrigins.has(req.headers.origin || '') || wss.clients.size >= 8) {
      console.warn('Rejected lesson websocket:', { origin: req.headers.origin || '(missing)', clients: wss.clients.size });
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let engine: LessonEngine | undefined;
    let nativeLanguage: NativeLanguage = 'English';
    let bridge: Bridge | undefined;
    let clientId: string = randomUUID();
    let avatarId: string | undefined;
    let liveVersion = 0;
    let liveStart: AbortController | undefined;
    let chatSequence = 0;
    let request: AbortController | undefined;
    let alive = true;
    let disposed = false;
    let lastAssessment = 0;
    let commandWindow = Date.now(), commands = 0, audioFrames = 0;
    const spokenQuestions = new Map<string, string>();
    const send = (event: LessonEvent) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(event)); };
    const publish = () => engine && send({ type: 'lesson', lesson: engine.state });
    const error = (message: string) => send({ type: 'error', message });
    const stopLive = async () => {
      const version = ++liveVersion;
      liveStart?.abort(); liveStart = undefined;
      const current = bridge; bridge = undefined;
      spokenQuestions.clear();
      if (current) await liveSlot.close(current);
      if (version === liveVersion) send({ type: 'ended' });
    };
    const submit = async (questionId: string, answer?: string, choice?: number) => {
      if (!engine) throw new Error('Start a lesson first.');
      if (Date.now() - lastAssessment < 600) throw new Error('Please wait a moment before submitting again.');
      const ticket = engine.begin(questionId);
      const controller = new AbortController(); request = controller;
      lastAssessment = Date.now();
      send({ type: 'checking' });
      try {
        let feedback;
        if (choice !== undefined) feedback = gradeChoice(engine.question, choice);
        else {
          if (!answer?.trim()) throw new Error('Speak or type your answer first.');
          feedback = await assessAnswer(engine.question, answer.trim(), nativeLanguage, controller.signal);
        }
        if (!disposed && engine.finish(ticket, feedback)) {
          publish();
          send({ type: 'turn', turn: { id: `feedback-${++chatSequence}`, role: 'assistant', text: `${feedback.japanese}\n${feedback.meaning}`, done: true } });
          bridge?.feedback(feedback);
        }
      } catch (cause) {
        engine.cancel(ticket);
        if (!disposed) { publish(); error(cause instanceof Error ? cause.message : 'Feedback could not finish. Please retry.'); }
      } finally { if (request === controller) request = undefined; }
    };
    ws.on('message', raw => {
      void (async () => {
        const input = command.parse(JSON.parse(raw.toString()));
        if (Date.now() - commandWindow >= 1000) { commands = 0; audioFrames = 0; commandWindow = Date.now(); }
        if (input.type === 'audio') {
          if (++audioFrames > 30) throw new Error('Too many microphone frames. Reconnect the microphone.');
          const bytes = Buffer.from(input.audio, 'base64');
          if (bytes.length % 2 || bytes.length > 12000) throw new Error('Invalid microphone audio.');
          bridge?.audio(input.audio); return;
        }
        if (++commands > 12) throw new Error('Too many requests. Please wait a moment.');
        if (input.type === 'start') {
          if (engine) throw new Error('Leave this lesson before starting another.');
          const character = input.characterId ? lessonCharacterForWorldNpc(input.characterId) : undefined;
          if (input.characterId && (!character || character.scenarioId !== input.scenarioId)) throw new Error('Choose the lesson assigned to this character.');
          const scenario = character ? scenarioForCharacter(character) : scenarios.find(item => item.id === input.scenarioId);
          if (!scenario) throw new Error('Choose an available scenario.');
          avatarId = character?.avatarId;
          clientId = input.clientId ?? clientId;
          nativeLanguage = input.language; engine = new LessonEngine(scenario);
          send({ type: 'connected', live: false, lesson: engine.state }); return;
        }
        if (!engine) throw new Error('Start a lesson first.');
        if (input.type === 'language') {
          if (bridge) throw new Error('Stop the avatar before changing your language.');
          nativeLanguage = input.language;
        }
        if (input.type === 'answer') {
          if (input.answer) send({ type: 'turn', turn: { id: `typed-${++chatSequence}`, role: 'user', text: input.answer, done: true } });
          await submit(input.questionId, input.answer, input.choice);
        }
        if (input.type === 'next' || input.type === 'retry') {
          engine[input.type](input.questionId); publish();
          if (engine.state.completed) await stopLive(); else bridge?.ask(engine.question);
        }
        if (input.type === 'avatar-ready') bridge?.avatarReady();
        if (input.type === 'stop-live') await stopLive();
        if (input.type === 'live') {
          if (!capabilities().liveAvatar) { send({ type: 'ended' }); throw new Error('Add your LiveAvatar API key and avatar ID to the lesson server to start the avatar.'); }
          if (bridge || liveStart) return;
          if (engine.state.completed) { send({ type: 'ended' }); throw new Error('Start a new lesson to use the avatar.'); }
          const version = ++liveVersion;
          const controller = new AbortController(); liveStart = controller;
          send({ type: 'live-starting' });
          const current = () => !disposed && liveVersion === version && !controller.signal.aborted;
          try {
          const created = await liveSlot.open(clientId, () => createBridge(engine!.scenario, nativeLanguage, engine!.question, {
            avatar: (url, token) => { if (current()) send({ type: 'avatar', url, token }); },
            ready: () => { if (current()) send({ type: 'ready' }); },
            failed: message => { if (current()) { error(message); void stopLive(); } },
            turn: turn => {
              if (!current()) return;
              send({ type: 'turn', turn });
              if (turn.role !== 'user' || !engine) return;
              if (!spokenQuestions.has(turn.id)) spokenQuestions.set(turn.id, engine.question.id);
              if (turn.done) {
                const questionId = spokenQuestions.get(turn.id)!; spokenQuestions.delete(turn.id);
                if (questionId === engine.question.id && !engine.state.completed && turn.text.trim()) {
                  void submit(questionId, turn.text.slice(0, 1500)).catch(cause => error(cause instanceof Error ? cause.message : 'Please retry your answer.'));
                }
              }
            },
          }, avatarId), controller.signal);
          if (!current()) { await liveSlot.close(created); return; }
          bridge = created;
          void created.start();
          } catch (cause) {
            if (current()) { send({ type: 'ended' }); error(cause instanceof Error ? cause.message : 'The avatar could not start. Please try again.'); }
          } finally { if (liveStart === controller) liveStart = undefined; }
        }
      })().catch(cause => error(cause instanceof z.ZodError || cause instanceof SyntaxError ? 'The lesson received an invalid request.' : cause instanceof Error ? cause.message : 'The lesson request failed.'));
    });
    ws.on('pong', () => { alive = true; });
    const heartbeat = setInterval(() => { if (!alive) ws.terminate(); else { alive = false; ws.ping(); } }, 30000);
    const expiry = setTimeout(() => ws.close(1000, 'Lesson expired'), 30 * 60 * 1000);
    const dispose = () => {
      if (disposed) return; disposed = true;
      clearInterval(heartbeat); clearTimeout(expiry);
      request?.abort(); engine?.cancel(); spokenQuestions.clear(); void stopLive();
    };
    ws.on('close', dispose); ws.on('error', dispose);
  });
  const close = async () => { for (const ws of wss.clients) ws.close(1001); wss.close(); server.close(); };
  return { server, close };
}
