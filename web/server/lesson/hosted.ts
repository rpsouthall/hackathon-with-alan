import { LiveBridge } from './live';
import { LiveSessionSlot } from './live-slot';
import { attachLessonSession, type Bridge } from './session';
import { capabilities, type LessonRuntime } from './runtime';
import { connectWorkerSocket, WorkerSocket } from './worker-socket';
import { LESSON_PROTOCOL, lessonSocketUrl, signLessonTicket } from '../../lib/lesson/hosted-ticket';

// Scope is this Worker isolate. Provider account concurrency also applies.
const slots = new LiveSessionSlot<Bridge>();
let connections = 0;
export function lessonIdentity(request: Request) {
  const user = request.headers.get('oai-authenticated-user-id');
  const email = request.headers.get('oai-authenticated-user-email');
  return user && email ? user : null;
}
export function hostedConfig(request: Request, runtime: LessonRuntime) {
  const authRequired = !lessonIdentity(request);
  return Response.json({ ...capabilities(runtime), authRequired, transport: runtime.LESSON_SERVER_URL ? 'ticket' : 'same-origin' }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function hostedConnect(request: Request, runtime: LessonRuntime) {
  const reply = (body: object, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) return reply({ error: 'Open the lesson from this site.' }, 403);
  const user = lessonIdentity(request);
  if (!user) return reply({ error: 'Sign in to start your private lesson.' }, 401);
  if (!runtime.LESSON_SERVER_URL || !runtime.WORLD_TICKET_SECRET) return reply({ error: 'The lesson connection is being prepared. Please try again.' }, 503);
  // Scope a pseudonymous owner to this Site; never send account headers or API keys to the browser.
  const ownerId = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${origin}:${user}`))), byte => byte.toString(16).padStart(2, '0')).join('');
  const ticket = await signLessonTicket({ audience: LESSON_PROTOCOL, ownerId, origin, nonce: crypto.randomUUID(), expiresAt: Date.now() + 60_000 }, runtime.WORLD_TICKET_SECRET);
  return reply({ url: lessonSocketUrl(runtime.LESSON_SERVER_URL), ticket });
}
export function hostedSession(request: Request, runtime: LessonRuntime, keepAlive: (promise: Promise<void>) => void) {
  const origin = new URL(request.url).origin;
  if (request.headers.get('origin') !== origin) return new Response('Open the lesson from this site.', { status: 403 });
  const ownerId = lessonIdentity(request);
  if (!ownerId) return new Response('Sign in to practise with the tutor.', { status: 401 });
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
  return openLessonSession(ownerId, runtime, keepAlive);
}
/** Call only after trusted Site identity or a signed lesson ticket is verified. */
export function openLessonSession(ownerId: string, runtime: LessonRuntime, keepAlive: (promise: Promise<void>) => void, protocol?: string) {
  if (connections >= 8) return new Response('Lessons are busy. Try again shortly.', { status: 503 });
  const pair = new WebSocketPair();
  pair[1].accept();
  const socket = new WorkerSocket(pair[1]);
  connections++;
  socket.once('close', () => { connections--; });
  attachLessonSession(socket, { runtime, ownerId, liveSlot: slots, keepAlive,
    createBridge: (scenario, language, question, sink, avatarId) => new LiveBridge(scenario, language, question, sink, avatarId ?? runtime.LIVEAVATAR_AVATAR_ID, connectWorkerSocket, runtime),
  });
  return new Response(null, { status: 101, webSocket: pair[0], headers: protocol ? { 'Sec-WebSocket-Protocol': protocol } : undefined });
}
