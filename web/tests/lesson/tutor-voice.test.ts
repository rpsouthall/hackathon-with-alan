import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LiveBridge } from '../../server/lesson/live';
import { lessonCharacterForWorldNpc, scenarioForCharacter } from '../../lib/lesson/characters';

class FakeSocket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent: string[] = [];
  send(data: string) { this.sent.push(data); }
  close() { this.readyState = 3; }
  terminate() { this.close(); }
}

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
