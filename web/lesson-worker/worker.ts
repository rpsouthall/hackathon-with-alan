import { LESSON_PROTOCOL, verifyLessonTicket } from '../lib/lesson/hosted-ticket';
import { openLessonSession } from '../server/lesson/hosted';
import type { LessonRuntime } from '../server/lesson/runtime';

interface Bindings {
  LESSON_ALLOWED_ORIGIN: string;
  LESSON_TICKET_SECRET: string;
  LESSON_ADMISSION: RateLimit;
}
// A ticket is consumed once in this isolate; it expires in one minute regardless.
const consumed = new Map<string, number>();
const worker = {
  async fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const path = new URL(request.url).pathname;
    if (path === '/health') return Response.json({ ok: true, protocol: LESSON_PROTOCOL });
    if (path !== '/lesson-api/session') return new Response('Not found', { status: 404 });
    const origin = request.headers.get('origin');
    if (!origin || origin !== env.LESSON_ALLOWED_ORIGIN) return new Response('Open the lesson from the Kyoto site.', { status: 403 });
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return new Response('WebSocket required', { status: 426 });
    const protocols = (request.headers.get('sec-websocket-protocol') ?? '').split(',').map(value => value.trim());
    if (protocols.length !== 2 || protocols[0] !== LESSON_PROTOCOL) return new Response('A lesson ticket is required.', { status: 401 });
    const ticket = await verifyLessonTicket(protocols[1], env.LESSON_TICKET_SECRET, origin);
    if (!ticket) return new Response('Your lesson ticket expired. Reconnect from the site.', { status: 401 });
    const now = Date.now();
    for (const [nonce, expires] of consumed) if (expires <= now) consumed.delete(nonce);
    if (consumed.has(ticket.nonce)) return new Response('Reconnect from the site for a new lesson ticket.', { status: 401 });
    if (!(await env.LESSON_ADMISSION.limit({ key: ticket.ownerId })).success) return new Response('Please wait a moment before reconnecting.', { status: 429 });
    consumed.set(ticket.nonce, ticket.expiresAt);
    return openLessonSession(ticket.ownerId, env as unknown as LessonRuntime, promise => ctx.waitUntil(promise), LESSON_PROTOCOL);
  },
};
export default worker;
