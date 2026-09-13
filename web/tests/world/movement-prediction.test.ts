import test, { before, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { initWorldPhysics } from "../../lib/world/physics";
import { LocalMovementPredictor, MAX_PREDICTION_MS } from "../../lib/world/movement-prediction";
import { WorldRoom } from "../../lib/world/room";
import { environmentSchema, type PlayerSnapshot, type WorldCommand } from "../../lib/world/schema";

before(initWorldPhysics);
function fixture(t: TestContext, wall = false) {
  const env = environmentSchema.parse({ id: "prediction", revision: "v1", name: "Prediction fixture", assetUrl: null,
    spawn: [0, 0.02, 0], bounds: { min: [-20, -3, -20], max: [20, 8, 20] }, colliders: [], npcSpawns: {},
    physics: { colliders: [
      { position: [0, -0.25, 0], halfExtents: [20, 0.25, 20], quaternion: [0, 0, 0, 1] },
      ...(wall ? [{ position: [1, 1, 0], halfExtents: [0.1, 1, 3], quaternion: [0, 0, 0, 1] }] : []),
    ] },
  });
  const room = new WorldRoom("prediction", env, []); room.join("learner", "Learner");
  const predictor = new LocalMovementPredictor(env);
  predictor.reconcile(room.snapshot().players[0], undefined, 0);
  t.after(() => { room.dispose(); predictor.dispose(); });
  return { room, predictor };
}

test("own walking starts on the first frame without an authority reply and stops on key release", (t) => {
  const { predictor } = fixture(t);
  predictor.recordInput(0, [1, 0], Math.PI / 2, false, 0);
  const first = predictor.advance(1000 / 60, 1 / 60)!;
  assert.ok(first.position[0] > 0.045, `first-frame movement: ${first.position[0]}`);
  predictor.advance(100, 0.083);
  predictor.recordInput(1, [0, 0], Math.PI / 2, false, 100);
  const stopped = predictor.advance(150, 0.05)!;
  const later = predictor.advance(200, 0.05)!;
  assert.ok(Math.abs(stopped.position[0] - later.position[0]) < 0.001);
  assert.equal(later.animation, "idle");
});

test("200ms round trip replays acknowledged inputs without delaying movement or creating recurring jumps", (t) => {
  const { room, predictor } = fixture(t);
  const commands: { at: number; command: WorldCommand }[] = [];
  const snapshots: { at: number; player: PlayerSnapshot }[] = [];
  let sequence = 0, previousX = 0, maximumJump = 0, positionAt100 = 0, positionAt600 = 0;
  for (let frame = 0; frame <= 120; frame++) {
    const now = frame * 1000 / 60;
    if (frame % 3 === 0) {
      const direction: [number, number] = now < 650 ? [1, 0] : [0, 0];
      const command: WorldCommand = { type: "move", direction, yaw: Math.PI / 2, sprint: false, sequence: sequence++ };
      predictor.recordInput(command.sequence, direction, command.yaw, false, now);
      commands.push({ at: now + 100, command });
    }
    while (commands.length && commands[0].at <= now + 1e-6) room.command("learner", commands.shift()!.command, now);
    room.tick(1 / 60, now);
    if (frame % 3 === 0) snapshots.push({ at: now + 100, player: room.snapshot().players[0] });
    while (snapshots.length && snapshots[0].at <= now + 1e-6) predictor.reconcile(snapshots.shift()!.player, undefined, now);
    const predicted = predictor.advance(now, 1 / 60)!;
    maximumJump = Math.max(maximumJump, Math.abs(predicted.position[0] - previousX));
    previousX = predicted.position[0];
    if (frame === 6) positionAt100 = predicted.position[0];
    if (frame === 36) positionAt600 = predicted.position[0];
  }
  assert.ok(positionAt100 > 0.2, `input moved before server reply: ${positionAt100}`);
  assert.ok(positionAt600 > 1.6, `latency does not reduce walking speed: ${positionAt600}`);
  assert.ok(maximumJump < 0.17, `largest correction/frame displacement: ${maximumJump}`);
  assert.ok(Math.abs(previousX - room.snapshot().players[0].position[0]) < 0.07, "stationary position converges to authority");
});

test("prediction respects collision walls while sprinting and reconciling delayed state", (t) => {
  const { room, predictor } = fixture(t, true);
  for (let frame = 0; frame < 45; frame++) {
    const now = frame * 1000 / 60;
    predictor.recordInput(frame, [1, 0], Math.PI / 2, true, now);
    if (frame === 25) {
      room.command("learner", { type: "move", direction: [1, 0], yaw: Math.PI / 2, sprint: true, sequence: 10 }, 100);
      room.tick(0.1, 100);
      predictor.reconcile(room.snapshot().players[0], undefined, now);
    }
    const position = predictor.advance(now, 1 / 60)!.position;
    assert.ok(position[0] < 0.64, `cannot pass wall with capsule radius: ${position[0]}`);
  }
});

test("lost server updates have a bounded prediction horizon and bounded input history", (t) => {
  const { predictor } = fixture(t);
  let atLimit = 0, final = 0;
  for (let now = 0, seq = 0; now <= 10_000; now += 50, seq++) {
    predictor.recordInput(seq, [1, 0], Math.PI / 2, false, now);
    final = predictor.advance(now, 0.05)!.position[0];
    if (now === MAX_PREDICTION_MS) atLimit = final;
  }
  assert.ok(Math.abs(final - atLimit) < 0.001, "avatar freezes rather than walking indefinitely from authority");
  assert.ok(predictor.pendingInputCount <= 41);
});

test("respawn and vehicle changes discard stale input, while riding is also predicted locally", (t) => {
  const { room, predictor } = fixture(t);
  predictor.recordInput(0, [1, 0], Math.PI / 2, false, 0);
  predictor.advance(100, 0.1);
  const player = room.snapshot().players[0];
  predictor.reconcile({ ...player, position: [-6, 0.02, 0] }, undefined, 110);
  assert.equal(predictor.pendingInputCount, 0);
  assert.ok(Math.abs(predictor.advance(150, 0.04)!.position[0] + 6) < 0.001);
  const vehicle = { id: "scooter", kind: "scooter" as const, position: [2, 0.02, 0] as [number, number, number], yaw: 0, riderId: "learner", speed: 0 };
  predictor.reconcile({ ...player, vehicleId: vehicle.id, position: vehicle.position }, vehicle, 160);
  predictor.recordInput(1, [1, 0], Math.PI / 2, false, 160);
  assert.ok(predictor.advance(260, 0.1)!.position[0] > 2.02);
});

test("encounters block local motion and authority acknowledges only simulated commands", (t) => {
  const { room, predictor } = fixture(t);
  room.command("learner", { type: "move", direction: [1, 0], yaw: Math.PI / 2, sequence: 7 }, 0);
  assert.equal(room.snapshot().players[0].movementAck, undefined);
  room.tick(0.05, 50);
  assert.equal(room.snapshot().players[0].movementAck?.sequence, 7);
  assert.equal(room.snapshot().players[0].movementAck?.elapsedSeconds, 0.05);
  predictor.recordInput(0, [1, 0], Math.PI / 2, true, 0);
  predictor.setBlocked(true);
  assert.ok(Math.abs(predictor.advance(100, 0.1)!.position[0]) < 0.001);
});

test("local start and stop remain immediate inside the wire send throttle window", (t) => {
  const { predictor } = fixture(t);
  predictor.recordInput(0, [0, 0], 0, false, 0);
  predictor.recordLocalInput([1, 0], Math.PI / 2, false, 1);
  assert.ok(predictor.advance(34, 0.034)!.position[0] > 0.04, "unsent local movement is simulated");
  predictor.recordLocalInput([0, 0], Math.PI / 2, false, 34);
  const stopping = predictor.advance(67, 0.033)!.position[0];
  assert.ok(Math.abs(predictor.advance(100, 0.033)!.position[0] - stopping) < 0.001);
});

test("resuming after a long blocked modal starts locally without waiting for another snapshot", (t) => {
  const { predictor } = fixture(t);
  predictor.setBlocked(true, 0);
  predictor.advance(5_000, 0.05);
  predictor.setBlocked(false, 5_000);
  predictor.recordLocalInput([1, 0], Math.PI / 2, false, 5_000);
  assert.ok(predictor.advance(5_017, 0.017)!.position[0] > 0.045);
});

test("one-second variable latency across a turn and stop remains bounded and converges", (t) => {
  const { room, predictor } = fixture(t);
  const commands: { at: number; command: WorldCommand }[] = [];
  const snapshots: { at: number; player: PlayerSnapshot }[] = [];
  let sequence = 0, lastCommandDelivery = 0, lastStateDelivery = 0;
  let previous: [number, number, number] = [0, 0.02, 0], largestStep = 0;
  for (let frame = 0; frame <= 300; frame++) {
    const now = frame * 1000 / 60;
    const direction: [number, number] = now < 600 ? [1, 0] : now < 1_100 ? [0, 1] : [0, 0];
    predictor.recordLocalInput(direction, Math.atan2(...direction), false, now);
    if (frame % 3 === 0) {
      const command: WorldCommand = { type: "move", direction, yaw: Math.atan2(...direction), sprint: false, sequence: sequence++ };
      predictor.recordInput(command.sequence, direction, command.yaw, false, now);
      lastCommandDelivery = Math.max(lastCommandDelivery + 1, now + 350 + (frame % 18) * 10);
      commands.push({ at: lastCommandDelivery, command });
    }
    while (commands.length && commands[0].at <= now) room.command("learner", commands.shift()!.command, now);
    room.tick(1 / 60, now);
    if (frame % 3 === 0) {
      lastStateDelivery = Math.max(lastStateDelivery + 1, now + 350 + ((frame + 9) % 18) * 10);
      snapshots.push({ at: lastStateDelivery, player: room.snapshot().players[0] });
    }
    while (snapshots.length && snapshots[0].at <= now) predictor.reconcile(snapshots.shift()!.player, undefined, now);
    const position = predictor.advance(now, 1 / 60)!.position;
    largestStep = Math.max(largestStep, Math.hypot(...position.map((value, axis) => value - previous[axis])));
    assert.ok(position.every(Number.isFinite));
    assert.ok(Math.hypot(position[0], position[2]) < 4, "jitter cannot extrapolate unlimited motion");
    previous = position;
  }
  assert.ok(largestStep < 0.4, `bounded visual correction per frame: ${largestStep}`);
  assert.ok(Math.hypot(...previous.map((value, axis) => value - room.snapshot().players[0].position[axis])) < 0.08);
});

test("repeated modal toggles during server loss cannot extend prediction indefinitely", (t) => {
  const { predictor } = fixture(t);
  let sequence = 0;
  for (let attempt = 0; attempt < 4; attempt++) {
    const start = attempt * 2_000;
    predictor.setBlocked(true, start);
    predictor.setBlocked(false, start);
    for (let frame = 0; frame <= 20; frame++) {
      const now = start + frame * 50;
      predictor.recordInput(sequence++, [1, 0], Math.PI / 2, false, now);
      assert.ok(predictor.advance(now, 0.05)!.position[0] < 2.3, "each stale resume is anchored to the last trusted authority pose");
    }
  }
});
