import test from 'node:test';
import assert from 'node:assert/strict';
import { HeldDirections, type HeldDirection } from '../../lib/world/held-directions';
test('held input persists without repeats and releasing one touch preserves the other', () => {
  let direction: HeldDirection = [0, 0];
  const held = new HeldDirections(value => { direction = value; });
  held.hold(1, [0, -1]);
  for (let frame = 0; frame < 300; frame++) assert.deepEqual(direction, [0, -1]);
  held.hold(2, [1, 0]); assert.deepEqual(direction, [1, -1]);
  held.release(1); assert.deepEqual(direction, [1, 0]);
  held.release(1); assert.deepEqual(direction, [1, 0]); // lost capture after pointer up
  held.release(2); assert.deepEqual(direction, [0, 0]);
});
test('clearing held contacts stops movement and later releases cannot restart it', () => {
  let direction: HeldDirection = [0, 0];
  const held = new HeldDirections(value => { direction = value; });
  held.hold(1, [0, -1]); held.hold('Move right', [1, 0]);
  held.clear(); assert.deepEqual(direction, [0, 0]);
  held.release(1); held.release('Move right'); assert.deepEqual(direction, [0, 0]);
  held.hold(3, [-1, 0]); assert.deepEqual(direction, [-1, 0]);
});
