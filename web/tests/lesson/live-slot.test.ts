import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveSessionSlot } from '../../server/lesson/live-slot';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

test('a new encounter waits for the previous avatar to finish closing', async () => {
  const gate = new LiveSessionSlot<{ close(): Promise<void> }>();
  const teardown = deferred();
  let closes = 0, creates = 0;
  const first = await gate.open('same-tab', () => ({ close: () => { closes++; return teardown.promise; } }), new AbortController().signal);
  const closing = gate.close(first);
  const replacement = gate.open('same-tab', () => { creates++; return { close: async () => {} }; }, new AbortController().signal);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(creates, 0);
  assert.equal(closes, 1);
  teardown.resolve(); await closing;
  const second = await replacement;
  assert.equal(creates, 1);
  await gate.close(second);
});

test('cancelling an encounter while teardown is pending does not create a paid session', async () => {
  const gate = new LiveSessionSlot<{ close(): Promise<void> }>();
  const teardown = deferred();
  await gate.open('same-tab', () => ({ close: () => teardown.promise }), new AbortController().signal);
  let creates = 0;
  const controller = new AbortController();
  const replacement = gate.open('same-tab', () => { creates++; return { close: async () => {} }; }, controller.signal);
  const rejected = assert.rejects(replacement, { name: 'AbortError' });
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(); teardown.resolve(); await rejected;
  assert.equal(creates, 0);
});

test('a tab refresh replaces its own avatar without terminating another player', async () => {
  const gate = new LiveSessionSlot<{ close(): Promise<void> }>();
  let closes = 0;
  await gate.open('player-a', () => ({ close: async () => { closes++; } }), new AbortController().signal);
  await assert.rejects(gate.open('player-b', () => ({ close: async () => {} }), new AbortController().signal), /Another player/);
  assert.equal(closes, 0);
  const replacement = await gate.open('player-a', () => ({ close: async () => {} }), new AbortController().signal);
  assert.equal(closes, 1);
  await gate.close(replacement);
});
