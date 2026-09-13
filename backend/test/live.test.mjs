import test from 'node:test';
import assert from 'node:assert/strict';
import { once, EventEmitter } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createLiveServer } from '../src/live-server.mjs';
import { closeLiveSession } from '../src/live-close.mjs';
import { transcriptFragment } from '../src/live-config.mjs';

async function fixture(t, options = {}) {
  const app = createLiveServer(options);
  app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
  t.after(async () => { await app.closeSessions(); app.server.closeAllConnections(); await new Promise(r => app.server.close(r)); });
  return (path, body, headers = {}) => new Promise((resolve, reject) => {
    const req = httpRequest(`http://127.0.0.1:${app.server.address().port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { host: 'localhost:8787', origin: 'http://localhost:8787', 'content-type': 'application/json', ...headers },
    }, response => {
      let text = ''; response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve(new Response(text, { status: response.statusCode })));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
test('local voice rejects foreign origins, invalid offers and missing keys before spending', async t => {
  const call = await fixture(t, { key: 'secret', fetchImpl: () => assert.fail('Unexpected paid call') });
  assert.equal((await call('/api/live/session', { sdp: 'v=0' }, { origin: 'https://other.test' })).status, 403);
  assert.equal((await call('/api/live/session', { sdp: 'v=0' }, { host: 'other.test' })).status, 403);
  assert.equal((await call('/api/live/session', { sdp: 'bad' })).status, 400);
  assert.equal((await call('/api/live/session', null)).status, 400);
  const noKey = await fixture(t, { fetchImpl: () => assert.fail() });
  assert.equal((await noKey('/api/live/session', { sdp: 'v=0' })).status, 503);
  assert.equal((await call('/.env')).status, 403);
});
test('session creation keeps credentials private, limits concurrency and stops only owned sessions', async t => {
  let request, closed;
  const call = await fixture(t, { key: 'private-secret', fetchImpl: async (url, options) => {
    request = { url, options }; return Response.json({ session: { id: 'live_opaque' }, transport: { sdp: 'v=0 answer' } });
  }, closeSession: async (...args) => { closed = args; return true; } });
  const response = await call('/api/live/session', { sdp: 'v=0 offer', model: 'client-override' });
  assert.equal(response.status, 201); const body = await response.json();
  assert.ok(!JSON.stringify(body).includes('private-secret'));
  assert.equal(JSON.parse(request.options.body).session.model, 'gpt-live-1');
  assert.equal(request.options.headers.Authorization, 'Bearer private-secret');
  assert.equal((await call('/api/live/session', { sdp: 'v=0' })).status, 409);
  await call('/api/live/stop', { ticket: 'unowned-session-id' }); assert.equal(closed, undefined);
  assert.equal((await call('/api/live/stop', { ticket: body.ticket })).status, 200);
  assert.deepEqual(closed, ['live_opaque', 'private-secret']);
});
test('quota errors do not expose upstream diagnostics', async t => {
  const call = await fixture(t, { key: 'secret', fetchImpl: async () => Response.json({ error: { code: 'insufficient_quota', message: 'private upstream details' } }, { status: 429 }) });
  const response = await call('/api/live/session', { sdp: 'v=0' });
  assert.equal(response.status, 429); const body = await response.text();
  assert.match(body, /quota/); assert.ok(!body.includes('private upstream'));
});
test('server closes a session at its time limit even without a browser stop', async t => {
  let resolveClosed; const closed = new Promise(r => { resolveClosed = r; });
  const call = await fixture(t, { key: 'secret', limitMs: 20,
    fetchImpl: async () => Response.json({ session: { id: 'live_timer' }, transport: { sdp: 'v=0' } }),
    closeSession: async id => { resolveClosed(id); return true; },
  });
  await call('/api/live/session', { sdp: 'v=0' });
  assert.equal(await closed, 'live_timer');
});
test('sideband waits for finalization and never restarts a WebRTC session', async () => {
  const socket = new EventEmitter(); socket.readyState = 1; socket.close = () => {}; socket.terminate = () => {};
  const sent = []; socket.send = text => sent.push(JSON.parse(text));
  const promise = closeLiveSession('live_id', 'secret', { connect: (url, options) => {
    assert.equal(url, 'wss://api.openai.com/v1/live/sessions/live_id/attach');
    assert.equal(options.headers.Authorization, 'Bearer secret'); return socket;
  } });
  socket.emit('open'); assert.deepEqual(sent, [{ type: 'session.close' }]);
  socket.emit('message', JSON.stringify({ type: 'session.closed' })); assert.equal(await promise, true);
});
test('a transport close alone does not confirm finalization', async () => {
  const socket = new EventEmitter(); socket.readyState = 3; socket.terminate = () => {};
  const promise = closeLiveSession('live_id', 'secret', { connect: () => socket });
  socket.emit('close'); assert.equal(await promise, false);
});
test('Japanese transcript fragments preserve whitespace and overlapping timings', () => {
  assert.deepEqual(transcriptFragment({ type: 'session.output_transcript.delta', delta: ' お茶', start_ms: 10, end_ms: 100 }), { speaker: 'npc', text: ' お茶', startMs: 10, endMs: 100 });
  assert.equal(transcriptFragment({ type: 'session.output_audio.delta', delta: 'AAAA' }), null);
});
