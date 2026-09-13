import test from "node:test";
import assert from "node:assert/strict";
import { PlayerInput, type InputKey } from "../../lib/world/player-input";
import { getVehicleControlState, vehicleSpeedKmh } from "../../components/world/vehicle-controls-state";
import type { VehicleSnapshot } from "../../lib/world/schema";

function key(value: string, options: Partial<InputKey> = {}) {
  let prevented = false;
  const event: InputKey = { key: value, code: `Key${value.toUpperCase()}`, repeat: false, ctrlKey: false, metaKey: false,
    altKey: false, shiftKey: false, isComposing: false, target: null, preventDefault() { prevented = true; }, ...options };
  return { event, prevented: () => prevented };
}

test("F mounts or dismounts once per press without changing held movement", () => {
  const input = new PlayerInput();
  input.keyDown(key("w").event);
  const first = key("f");
  assert.equal(input.keyDown(first.event), "vehicle");
  assert.equal(first.prevented(), true);
  assert.deepEqual(input.direction, [0, -1]);
  assert.equal(input.keyDown(key("f", { repeat: true }).event), undefined);
  input.keyUp(key("f").event);
  assert.equal(input.keyDown(key("F").event), "vehicle");
  input.clear(); assert.deepEqual(input.direction, [0, 0]);
});

test("vehicle shortcut ignores typing, IME composition and browser modifiers", () => {
  const input = new PlayerInput();
  for (const options of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true },
    { target: { closest: () => ({}) } as unknown as EventTarget }]) {
    const attempt = key("f", options);
    assert.equal(input.keyDown(attempt.event), undefined);
    assert.equal(attempt.prevented(), false);
  }
});

test("vehicle key leaves camera, emotes, conversation and push-to-talk keys intact", () => {
  const input = new PlayerInput();
  assert.equal(input.keyDown(key("v").event), "view");
  assert.equal(input.keyDown(key("g").event), "emotes");
  assert.equal(input.keyDown(key("e").event), "interact");
  const voice = key("t"); assert.equal(input.keyDown(voice.event), undefined); assert.equal(voice.prevented(), false);
});

const player = { id: "learner", position: [0, .3, 0] as [number, number, number], vehicleId: null as string | null };
const vehicle = (id: string, x: number, riderId: string | null = null): VehicleSnapshot =>
  ({ id, kind: "scooter", position: [x, .3, 0], yaw: 0, riderId, speed: 0 });

test("context offers the nearest available ride within the full 2m mounting radius", () => {
  const near = vehicle("near", 1), occupied = vehicle("occupied", .1, "someone-else"), edge = vehicle("edge", 2);
  assert.equal(getVehicleControlState(player, [edge, occupied, near])?.vehicle.id, "near");
  assert.equal(getVehicleControlState(player, [edge])?.mode, "available");
  assert.equal(getVehicleControlState(player, [vehicle("outside", 2.001)]), null);
  assert.equal(getVehicleControlState(player, [{ ...edge, position: [0, 2.301, 0] }]), null);
});

test("equal-distance choices are stable when network snapshot order changes", () => {
  const a = vehicle("a", 1), b = vehicle("b", -1);
  assert.equal(getVehicleControlState(player, [a, b])?.vehicle.id, "a");
  assert.equal(getVehicleControlState(player, [b, a])?.vehicle.id, "a");
});

test("mounted rider sees their ride, and disabled input hides every vehicle action", () => {
  const board = { ...vehicle("board", 10, player.id), kind: "skateboard" as const, speed: 6 };
  const rider = { ...player, vehicleId: board.id };
  assert.equal(getVehicleControlState(rider, [vehicle("nearby", .2), board])?.mode, "riding");
  assert.equal(getVehicleControlState(rider, [board], true), null);
  assert.equal(getVehicleControlState(player, [vehicle("available", 1)], true), null);
  assert.equal(getVehicleControlState(undefined, [board]), null);
  assert.equal(getVehicleControlState(rider, [{ ...board, riderId: "other" }]), null);
});

test("speed display uses authoritative metres per second without invalid text", () => {
  assert.equal(vehicleSpeedKmh(7), 25);
  assert.equal(vehicleSpeedKmh(6), 22);
  assert.equal(vehicleSpeedKmh(0), 0);
  assert.equal(vehicleSpeedKmh(NaN), 0);
});
