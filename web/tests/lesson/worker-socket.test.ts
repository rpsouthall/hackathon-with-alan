import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkerSocket } from '../../server/lesson/worker-socket';

test('Worker provider upgrade uses manual redirects and refuses redirects without forwarding credentials', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    calls++;
    assert.equal(String(url), 'https://provider.example/live');
    assert.equal(options?.redirect, 'manual', 'Workers rejects redirect:error before making a request');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer local-test-key');
    return new Response(null, { status: 302, headers: { Location: 'https://untrusted.example/' } });
  };
  try {
    const socket = new WorkerSocket();
    let failure = '';
    socket.on('error', error => { failure = error.message; });
    await socket.connect('wss://provider.example/live', { Authorization: 'Bearer local-test-key' });
    assert.equal(calls, 1);
    assert.match(failure, /HTTP 302/);
    assert.equal(failure.includes('local-test-key'), false);
    assert.equal(socket.readyState, 3);
  } finally { globalThis.fetch = original; }
});
