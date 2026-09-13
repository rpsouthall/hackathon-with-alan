import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createLessonServer, capabilities } from '../../server/lesson/server';
import { scenarios } from '../../lib/lesson/scenarios';

test('local socket validates origin and progress; AI feedback stays server-side; missing avatar fails closed', async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.OPENAI_API_KEY;
  const originalAvatarKey = process.env.LIVEAVATAR_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-never-sent-to-browser';
  delete process.env.LIVEAVATAR_API_KEY;
  let requests = 0;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    assert.equal((options?.headers as Record<string, string>).Authorization, 'Bearer test-key-never-sent-to-browser');
    requests++;
    return new Response(JSON.stringify({ output: [{ content: [{ type: 'output_text', text: JSON.stringify({ verdict: 'correct', explanation: 'That English answer is clear.', japanese: '一人です。', reading: 'Hitori desu.', meaning: 'Just one person.' }) }] }] }), { status: 200 });
  };
  const app = createLessonServer();
  const wsClients: WebSocket[] = [];
  try {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const address = app.server.address(); assert.ok(address && typeof address === 'object');
    const url = `ws://127.0.0.1:${address.port}/lesson-api/session`;
    const rejected = new WebSocket(url, { origin: 'https://untrusted.example' }); wsClients.push(rejected);
    const [rejection] = await once(rejected, 'error'); assert.match(String(rejection), /403/);
    const ws = new WebSocket(url, { origin: 'http://localhost:5173' }); wsClients.push(ws);
    await once(ws, 'open');
    const messages: Record<string, unknown>[] = [];
    ws.on('message', raw => messages.push(JSON.parse(raw.toString())));
    async function command(input: object, type: string) {
      const result = new Promise<Record<string, unknown>>((resolve, reject) => {
        const timer = setTimeout(() => { ws.off('message', receive); reject(new Error(`No ${type} message`)); }, 3000);
        const receive = (raw: Buffer) => {
          const message = JSON.parse(raw.toString());
          if (message.type === type) { clearTimeout(timer); ws.off('message', receive); resolve(message); }
        };
        ws.on('message', receive);
      });
      ws.send(JSON.stringify(input)); return result;
    }
    const scenario = scenarios[0];
    const start = await command({ type: 'start', scenarioId: scenario.id, language: 'English' }, 'connected');
    assert.equal((start.lesson as { index: number }).index, 0);
    await command({ type: 'next', questionId: scenario.questions[0].id }, 'error');
    await command({ type: 'answer', questionId: 'not-current', answer: 'Skip lesson' }, 'error');
    assert.equal(requests, 0);
    const answer = await command({ type: 'answer', questionId: scenario.questions[0].id, answer: 'Just one person.' }, 'lesson');
    assert.equal((answer.lesson as { feedback: { verdict: string } }).feedback.verdict, 'correct');
    assert.equal(requests, 1);
    const next = await command({ type: 'next', questionId: scenario.questions[0].id }, 'lesson');
    assert.equal((next.lesson as { index: number }).index, 1);
    const chat = messages.filter(message => message.type === 'turn').map(message => message.turn as { role: string; text: string });
    assert.ok(chat.some(turn => turn.role === 'user' && turn.text === 'Just one person.'));
    assert.ok(chat.some(turn => turn.role === 'assistant' && turn.text === '一人です。\nJust one person.'));
    await command({ type: 'live' }, 'error');
    assert.equal(requests, 1);
    assert.equal(capabilities().liveAvatar, false);
    assert.equal(JSON.stringify(messages).includes('test-key'), false);
    assert.equal(JSON.stringify(capabilities()).includes('test-key'), false);
  } finally {
    wsClients.forEach(ws => ws.terminate()); await app.close();
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = originalKey;
    if (originalAvatarKey === undefined) delete process.env.LIVEAVATAR_API_KEY; else process.env.LIVEAVATAR_API_KEY = originalAvatarKey;
  }
});
