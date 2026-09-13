import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TurnProjector } from '../../server/lesson/turns';
import type { Turn } from '../../lib/lesson/types';

test('Japanese deltas retain spacing and interleaved roles remain separate', () => {
  const turns: Turn[] = []; let openings = 0;
  const projector = new TurnProjector({ onTurn: turn => turns.push(turn), onUserTurnStarted: () => openings++ });
  projector.fragment('user', 'コーヒーを', 0, 200);
  projector.fragment('assistant', 'はい', 50, 150);
  projector.fragment('user', 'ください。', 200, 400);
  projector.close('user');
  assert.equal(turns.at(-1)?.text, 'コーヒーをください。');
  assert.equal(turns.at(-1)?.done, true);
  assert.equal(openings, 1);
  projector.dispose();
});
test('a timeline gap closes the old turn and opens a new one', () => {
  const turns: Turn[] = [];
  const projector = new TurnProjector({ onTurn: turn => turns.push(turn), onUserTurnStarted() {} });
  projector.fragment('user', 'First', 0, 200);
  projector.fragment('user', 'Second', 2200, 2400);
  assert.equal(turns[1].done, true);
  assert.notEqual(turns[0].id, turns[2].id);
  projector.dispose();
});
