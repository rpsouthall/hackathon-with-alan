import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LESSON_PROTOCOL, lessonSocketUrl, signLessonTicket, verifyLessonTicket } from '../../lib/lesson/hosted-ticket';
import { signWorldTicket } from '../../lib/world/hosted-ticket';
import { hostedConfig, hostedConnect } from '../../server/lesson/hosted';

const origin = 'https://kyoto.example';
const secret = 'local-test-secret-which-is-not-a-provider-key';
const runtime = { WORLD_TICKET_SECRET: secret, LESSON_SERVER_URL: 'https://lessons.example', OPENAI_API_KEY: 'test-api-key' };
const request = (headers: Record<string, string> = {}) => new Request(`${origin}/lesson-api/connect`, { method: 'POST', headers: { origin, ...headers } });
const identity = { 'oai-authenticated-user-id': 'local-user', 'oai-authenticated-user-email': 'local@example.test' };

test('lesson admission requires same-origin signed-in identity and exposes only an expiring lesson ticket', async () => {
  assert.equal((await hostedConnect(request(), runtime)).status, 401);
  assert.equal((await hostedConnect(request({ ...identity, origin: 'https://other.example' }), runtime)).status, 403);
  assert.equal((await hostedConnect(request(identity), {})).status, 503);
  const response = await hostedConnect(request(identity), runtime);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json() as { url: string; ticket: string };
  assert.equal(body.url, 'wss://lessons.example/lesson-api/session');
  const ticket = await verifyLessonTicket(body.ticket, secret, origin);
  assert.ok(ticket);
  assert.equal(ticket.audience, LESSON_PROTOCOL);
  assert.notEqual(ticket.ownerId, 'local-user');
  assert.equal(JSON.stringify(body).includes('test-api-key'), false);
  assert.equal(await verifyLessonTicket(body.ticket, secret, 'https://other.example'), null);
  assert.equal(await verifyLessonTicket(body.ticket, secret, origin, ticket.expiresAt), null);
  assert.equal(await verifyLessonTicket(`${body.ticket}broken`, secret, origin), null);
  assert.equal(await verifyLessonTicket(body.ticket, `${secret}wrong`, origin), null);
  assert.equal((await hostedConfig(request(identity), runtime).json() as { transport: string }).transport, 'ticket');
});

test('world tickets cannot authorize paid lessons even with a shared signing secret', async () => {
  const world = await signWorldTicket({ roomId: 'test', name: 'Test', playerId: crypto.randomUUID(), nonce: crypto.randomUUID(), expiresAt: Date.now() + 60_000, origin }, secret);
  assert.equal(await verifyLessonTicket(world, secret, origin), null);
  const farFuture = await signLessonTicket({ audience: LESSON_PROTOCOL, ownerId: 'test', nonce: crypto.randomUUID(), origin, expiresAt: Date.now() + 100_000 }, secret);
  assert.equal(await verifyLessonTicket(farFuture, secret, origin), null);
  assert.throws(() => lessonSocketUrl('http://lessons.example'));
  assert.throws(() => lessonSocketUrl('https://user:password@lessons.example'));
});
