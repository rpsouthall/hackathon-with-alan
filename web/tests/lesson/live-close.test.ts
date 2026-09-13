import test from 'node:test';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import assert from 'node:assert/strict';
import { LiveBridge } from '../../server/lesson/live';
import { scenarios } from '../../lib/lesson/scenarios';

class FakeSocket extends EventEmitter {
  readyState: number = WebSocket.CONNECTING;
  bufferedAmount = 0;
  sent: Record<string, unknown>[] = [];
  open() { this.readyState = WebSocket.OPEN; this.emit('open'); }
  message(event: object) { this.emit('message', Buffer.from(JSON.stringify(event))); }
  send(data: string) {
    const event = JSON.parse(data); this.sent.push(event);
    if (event.type === 'session.close') queueMicrotask(() => this.terminate());
  }
  terminate() { this.readyState = WebSocket.CLOSED; this.emit('close'); }
  close() { this.terminate(); }
}
const fakeConnect = () => new FakeSocket() as unknown as WebSocket;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
const sink = { avatar() { assert.fail('A departed encounter must not show a late avatar'); }, ready() {}, turn() {}, failed() {} };

test('closing during token creation waits for the token and stops it exactly once', async () => {
  const original = globalThis.fetch;
  const token = deferred<Response>();
  const paths: string[] = [];
  globalThis.fetch = async url => {
    const path = String(url).split('/').at(-1)!; paths.push(path);
    if (path === 'token') return token.promise;
    assert.equal(path, 'stop');
    return Response.json({ data: {} });
  };
  try {
    const bridge = new LiveBridge(scenarios[0], 'English', scenarios[0].questions[0], sink, 'test-avatar', fakeConnect);
    const starting = bridge.start();
    const closing = bridge.close();
    assert.equal(bridge.close(), closing);
    let closed = false; void closing.then(() => { closed = true; });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(closed, false);
    token.resolve(Response.json({ data: { session_id: 'test-session', session_token: 'test-session-token' } }));
    await Promise.all([starting, closing]);
    await bridge.start();
    assert.deepEqual(paths, ['token', 'stop']);
  } finally { globalThis.fetch = original; }
});

test('closing during provider start waits for start to settle before stopping the session', async () => {
  const original = globalThis.fetch;
  const pendingStart = deferred<Response>();
  const startCalled = deferred<void>();
  const paths: string[] = [];
  globalThis.fetch = async url => {
    const path = String(url).split('/').at(-1)!; paths.push(path);
    if (path === 'token') return Response.json({ data: { session_id: 'test-session', session_token: 'test-session-token' } });
    if (path === 'start') { startCalled.resolve(); return pendingStart.promise; }
    assert.equal(path, 'stop');
    return Response.json({ data: {} });
  };
  try {
    const bridge = new LiveBridge(scenarios[0], 'English', scenarios[0].questions[0], sink, 'test-avatar', fakeConnect);
    const starting = bridge.start(); await startCalled.promise;
    const closing = bridge.close();
    assert.deepEqual(paths, ['token', 'start']);
    pendingStart.resolve(Response.json({ data: {} }));
    await Promise.all([starting, closing]);
    assert.deepEqual(paths, ['token', 'start', 'stop']);
  } finally { globalThis.fetch = original; }
});

 test('voice connects while avatar provisioning is pending; speech waits for all three readiness signals', async () => {
  const original = globalThis.fetch;
  const token = deferred<Response>();
  const sockets: FakeSocket[] = [];
  let ready = 0;
  const bridge = new LiveBridge(scenarios[0], 'English', scenarios[0].questions[0], {
    avatar() {}, ready() { ready++; }, turn() {}, failed(message) { assert.fail(message); },
  }, 'test-avatar', () => {
    const socket = new FakeSocket(); sockets.push(socket); return socket as unknown as WebSocket;
  });
  globalThis.fetch = async url => {
    const path = String(url).split('/').at(-1);
    if (path === 'token') return token.promise;
    if (path === 'start') return Response.json({ data: { ws_url: 'wss://test.invalid', livekit_url: 'wss://room.invalid', livekit_client_token: 'fake' } });
    return Response.json({ data: {} });
  };
  try {
    const starting = bridge.start();
    assert.equal(sockets.length, 1, 'GPT must connect before HeyGen token returns');
    const gpt = sockets[0]; gpt.open(); gpt.message({ type: 'session.started' });
    assert.equal(ready, 0);
    token.resolve(Response.json({ data: { session_id: 'test-session', session_token: 'fake' } }));
    await starting;
    const media = sockets[1]; media.open(); media.message({ type: 'session.state_updated', state: 'connected' });
    gpt.message({ type: 'session.output_audio.delta', delta: 'early' });
    assert.equal(ready, 0);
    assert.equal(media.sent.length, 0, 'No unheard speech before the viewer is ready');
    bridge.avatarReady(); bridge.avatarReady();
    assert.equal(ready, 1);
    assert.equal(gpt.sent.filter(event => event.type === 'session.instructions.append').length, 1);
    gpt.message({ type: 'session.output_audio.delta', delta: 'audible' });
    assert.deepEqual(media.sent.at(-1), { type: 'agent.speak', audio: 'audible' });
  } finally { await bridge.close(); globalThis.fetch = original; }
});

for (const [message, expected] of [
  ['Insufficient credits', /HeyGen credits are exhausted/],
  ['Avatar access denied', /could not create.*403/],
] as const) {
  test(`provider failure is safely classified: ${message}`, async () => {
    const original = globalThis.fetch;
    let failure = '';
    globalThis.fetch = async () => Response.json({ message }, { status: 403 });
    const bridge = new LiveBridge(scenarios[0], 'English', scenarios[0].questions[0], {
      avatar() { assert.fail('No avatar on failed allocation'); }, ready() {}, turn() {},
      failed(value) { failure = value; },
    }, 'test-avatar', fakeConnect);
    try {
      await bridge.start(); await bridge.close();
      assert.match(failure, expected);
    } finally { globalThis.fetch = original; }
  });
}
