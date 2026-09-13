import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createLessonServer } from '../../server/lesson/server';

const receive = (ws: WebSocket, type: string) => new Promise<Record<string, unknown>>((resolve, reject) => {
  const timer = setTimeout(() => { ws.off('message', listener); reject(new Error(`Missing ${type}`)); }, 3000);
  const listener = (raw: Buffer) => {
    const event = JSON.parse(raw.toString());
    if (event.type === type) { clearTimeout(timer); ws.off('message', listener); resolve(event); }
  };
  ws.on('message', listener);
});
const command = (ws: WebSocket, data: object, type: string) => { const pending = receive(ws, type); ws.send(JSON.stringify(data)); return pending; };

test('re-entering an encounter replaces the same tab session after teardown and validates NPC identity', async () => {
  const previous = ['OPENAI_API_KEY', 'LIVEAVATAR_API_KEY', 'LIVEAVATAR_AVATAR_ID'].map(key => [key, process.env[key]] as const);
  for (const [key] of previous) process.env[key] = 'test-only';
  let creates = 0;
  let release!: () => void, closingStarted!: () => void;
  const teardown = new Promise<void>(resolve => { release = resolve; });
  const closing = new Promise<void>(resolve => { closingStarted = resolve; });
  const identities: string[] = [];
  const app = createLessonServer({ createBridge: (scenario, _language, _question, sink, avatarId) => {
    const number = ++creates; identities.push(scenario.name);
    assert.ok(avatarId && avatarId !== 'test-only', 'The character must use its server-allowlisted avatar.');
    let closePromise: Promise<void> | undefined;
    return {
      start: async () => { sink.avatar('wss://test.invalid', 'test-viewer-token'); sink.ready(); },
      close: () => closePromise ??= number === 1 ? (closingStarted(), teardown) : Promise.resolve(),
      audio() {}, ask() {}, feedback() {}, avatarReady() {},
    };
  } });
  const clients: WebSocket[] = [];
  try {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const address = app.server.address(); assert.ok(address && typeof address === 'object');
    const connect = async () => {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/lesson-api/session`, { origin: 'http://localhost:5173' });
      clients.push(ws); await once(ws, 'open'); return ws;
    };
    const first = await connect();
    await command(first, { type: 'start', scenarioId: 'coffee', characterId: 'cafe_owner', clientId: 'same-tab', language: 'English' }, 'connected');
    await command(first, { type: 'live' }, 'ready');
    first.send(JSON.stringify({ type: 'live' }));
    const second = await connect();
    await command(second, { type: 'start', scenarioId: 'coffee', characterId: 'market_produce', clientId: 'same-tab', language: 'English' }, 'error');
    await command(second, { type: 'start', scenarioId: 'market', characterId: 'market_produce', clientId: 'same-tab', language: 'English' }, 'connected');
    const secondReady = command(second, { type: 'live' }, 'ready');
    await closing;
    assert.equal(creates, 1, 'No duplicate or overlapping provider session');
    release(); await secondReady;
    assert.equal(creates, 2);
    assert.deepEqual(identities, ['Aoi', 'Yui']);
    await command(second, { type: 'stop-live' }, 'ended');
  } finally {
    release?.(); clients.forEach(ws => ws.terminate()); await app.close();
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

test('two learners keep private lessons and cannot interrupt each other’s live avatar', async () => {
  const previous = ['OPENAI_API_KEY', 'LIVEAVATAR_API_KEY', 'LIVEAVATAR_AVATAR_ID'].map(key => [key, process.env[key]] as const);
  for (const [key] of previous) process.env[key] = 'test-only';
  const opened: string[] = [], closed: string[] = [];
  const app = createLessonServer({ createBridge: (scenario, _language, _question, sink) => ({
    start: async () => { opened.push(scenario.id); sink.ready(); },
    close: async () => { closed.push(scenario.id); },
    audio() {}, ask() {}, feedback() {}, avatarReady() {},
  }) });
  const clients: WebSocket[] = [];
  try {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const address = app.server.address(); assert.ok(address && typeof address === 'object');
    for (let i = 0; i < 2; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/lesson-api/session`, { origin: 'http://localhost:5173' });
      clients.push(ws); await once(ws, 'open');
    }
    const [a, b] = clients;
    const first = await command(a, { type: 'start', scenarioId: 'coffee', characterId: 'cafe_owner', clientId: 'learner-a', language: 'English' }, 'connected');
    const second = await command(b, { type: 'start', scenarioId: 'market', characterId: 'market_produce', clientId: 'learner-b', language: 'Japanese' }, 'connected');
    assert.notDeepEqual(first.lesson, second.lesson, 'Each learner keeps the selected scenario');
    await command(a, { type: 'live' }, 'ready');
    const busy = await command(b, { type: 'live' }, 'error');
    assert.match(String(busy.message), /another|busy|in use/i);
    assert.deepEqual(opened, ['coffee']); assert.deepEqual(closed, []);
    await command(a, { type: 'stop-live' }, 'ended');
    await command(b, { type: 'live' }, 'ready');
    assert.deepEqual(opened, ['coffee', 'market']);
    a.close(); await once(a, 'close');
    assert.deepEqual(closed, ['coffee'], 'The departed learner cannot close the other avatar');
    await command(b, { type: 'stop-live' }, 'ended');
    assert.deepEqual(closed, ['coffee', 'market']);
  } finally {
    clients.forEach(ws => ws.terminate()); await app.close();
    for (const [key, value] of previous) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
