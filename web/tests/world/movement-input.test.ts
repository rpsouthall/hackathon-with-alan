import test from "node:test";
import assert from "node:assert/strict";
import { MovementSendThrottle, MIN_MOVEMENT_SEND_MS } from "../../lib/world/movement-input";

for (const hz of [60, 120, 144, 240]) test(`${hz}Hz camera orbit cannot bypass the movement wire ceiling`, () => {
  const throttle = new MovementSendThrottle();
  const sent: number[] = [];
  for (let frame = 0; frame < hz * 3; frame++) {
    const now = frame * 1000 / hz, yaw = Math.sin(frame / 20) * Math.PI;
    if (throttle.take({ direction: [Math.sin(yaw), Math.cos(yaw)], yaw, sprint: frame % 17 === 0 }, now)) sent.push(now);
  }
  assert.equal(sent[0], 0);
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i] - sent[i - 1] >= MIN_MOVEMENT_SEND_MS - 1e-6);
  for (const start of sent) assert.ok(sent.filter((time) => time >= start && time < start + 1000).length <= 40);
});

test("a queued key release becomes sendable within25ms even when rendering/input is then blocked", () => {
  const throttle = new MovementSendThrottle();
  const moving = { direction: [1, 0] as [number, number], yaw: Math.PI / 2, sprint: false };
  const stopped = { ...moving, direction: [0, 0] as [number, number] };
  assert.equal(throttle.take(moving, 0), true);
  assert.equal(throttle.take(stopped, 1), false);
  assert.equal(throttle.retryAfter(stopped, 1), 24);
  assert.equal(throttle.take(stopped, 25), true);
});
