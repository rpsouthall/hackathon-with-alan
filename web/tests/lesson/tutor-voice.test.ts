import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LiveBridge } from '../../server/lesson/live';
import { lessonCharacterForWorldNpc, scenarioForCharacter } from '../../lib/lesson/characters';
import { scenarioAtDifficulty } from '../../lib/lesson/difficulty';

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  terminate() { this.close(); }
}

test('live sessions coach Japanese learners in English and speak assessed corrections after acknowledgement', async () => {
  const character = lessonCharacterForWorldNpc('cafe_owner')!;
  const scenario = scenarioForCharacter(character);
  const sockets: FakeSocket[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = async url => Response.json({ data: String(url).endsWith('/token')
    ? { session_id: 'test-session', session_token: 'test-token' }
    : { ws_url: 'wss://test.invalid', livekit_url: 'wss://test.invalid', livekit_client_token: 'test-token' } });
  const bridge = new LiveBridge(scenario, 'Japanese', scenario.questions[0], {
    avatar() {}, ready() {}, turn() {}, failed(message) { assert.fail(message); },
  }, character.avatarId, () => { const socket = new FakeSocket(); sockets.push(socket); return socket; });
  try {
    await bridge.start();
    const [gpt, media] = sockets;
    const messages = () => gpt.sent.map(value => JSON.parse(value));
    gpt.emit('open');
    assert.match(messages()[0].session.instructions, /Use ENGLISH/);
    assert.match(messages()[0].session.instructions, /do not switch your coaching into Japanese/);
    gpt.emit('message', JSON.stringify({ type: 'session.started' }));
    media.emit('message', JSON.stringify({ type: 'session.state_updated', state: 'connected' }));
    bridge.avatarReady();

    const advanced = scenarioAtDifficulty(scenario, 'difficult').questions[0];
    bridge.ask(advanced);
    assert.match(messages().at(-1).content, /ENGLISH/);
    assert.ok(messages().at(-1).content.includes(advanced.task));

    const quiz = { ...scenario.questions[0], kind: 'meaning' as const, japanese: '練習の質問', meaning: 'Hidden translation', modelAnswer: 'Hidden answer', options: ['A', 'B'], correctIndex: 0 };
    bridge.ask(quiz);
    const quizPrompt = messages().at(-1).content;
    assert.ok(quizPrompt.includes(quiz.japanese));
    assert.ok(!quizPrompt.includes(quiz.modelAnswer));
    assert.ok(!quizPrompt.includes(quiz.meaning));

    bridge.feedback({ verdict: 'improve', answer: 'コーヒー', explanation: 'Add please to make your order polite.', japanese: 'コーヒーをお願いします。', reading: 'Koohii o onegaishimasu.', meaning: 'Coffee, please.' });
    const correction = messages().at(-1);
    assert.equal(correction.type, 'session.instructions.append');
    assert.match(correction.content, /Give feedback in ENGLISH/);
    assert.match(correction.content, /Add please to make your order polite/);
    assert.match(correction.content, /コーヒーをお願いします/);
    assert.equal(JSON.parse(media.sent.at(-1)!).type, 'agent.interrupt');
    gpt.emit('message', JSON.stringify({ type: 'session.instructions.appended', client_event_id: correction.event_id }));
    assert.equal(messages().at(-1).type, 'session.commentary.append');
    assert.match(messages().at(-1).content, /speak now/);
  } finally { await bridge.close(); globalThis.fetch = original; }
});

for (const [id, expected] of [
  ['cafe_owner', 'marin'], ['local_guide', 'cedar'], ['inn_host', 'cedar'],
  ['market_produce', 'marin'], ['market_tea', 'cedar'],
] as const) {
  test(`${id} starts GPT with its assigned ${expected} voice`, async () => {
    const character = lessonCharacterForWorldNpc(id)!;
    const scenario = scenarioForCharacter(character);
    const sockets: FakeSocket[] = [];
    const original = globalThis.fetch;
    globalThis.fetch = async url => Response.json({ data: String(url).endsWith('/token')
      ? { session_id: 'test-session', session_token: 'test-token' }
      : { ws_url: 'wss://test.invalid', livekit_url: 'wss://test.invalid', livekit_client_token: 'test-token' } });
    const bridge = new LiveBridge(scenario, 'English', scenario.questions[0], {
      avatar() {}, ready() {}, turn() {}, failed(message) { assert.fail(message); },
    }, character.avatarId, () => { const socket = new FakeSocket(); sockets.push(socket); return socket; });
    try {
      await bridge.start();
      sockets[0].emit('open');
      const start = JSON.parse(sockets[0].sent[0]);
      assert.equal(start.type, 'session.start');
      assert.equal(start.session.audio.output.voice, expected);
    } finally { await bridge.close(); globalThis.fetch = original; }
  });
}
