import test from "node:test";
import assert from "node:assert/strict";
import { WorldRoom } from "../../lib/world/room";
import { PlayerInput, type InputKey } from "../../lib/world/player-input";
import { EMOTES, EMOTE_NAMES, WALK_SPEED, SPRINT_SPEED } from "../../lib/world/player-actions";
import { DEFAULT_ENVIRONMENT } from "../../lib/world/defaults";
import { commandSchema, environmentSchema } from "../../lib/world/schema";
import { initWorldPhysics } from "../../lib/world/physics";

test("authority normalizes sprint, returns to walking on release, and expires held input", () => {
  const room = new WorldRoom(); room.join("walk", "Walker"); room.join("run", "Runner");
  for (const id of ["walk", "run"]) room.command(id, { type: "move", direction: [1, 1], yaw: 1, sequence: 0, sprint: id === "run" }, 0);
  room.tick(0.1, 0);
  const [walk, run] = room.snapshot().players;
  const travelled = (p: typeof walk) => Math.hypot(p.position[0], p.position[2] - 4);
  assert(Math.abs(travelled(walk) - WALK_SPEED * 0.1) < 1e-6);
  assert(Math.abs(travelled(run) - SPRINT_SPEED * 0.1) < 1e-6);
  assert.equal(walk.animation, "walk"); assert.equal(run.animation, "run");
  room.command("run", { type: "move", direction: [1, 0], yaw: 1, sequence: 1, sprint: false }, 100);
  room.tick(0.1, 100);
  const released = room.snapshot().players[1];
  assert.equal(released.animation, "walk"); assert(Math.abs(released.position[0] - run.position[0] - 0.3) < 1e-6);
  room.tick(0.1, 401); assert.deepEqual(room.snapshot().players[1].position, released.position);
  assert.equal(room.snapshot().players[1].animation, "idle"); room.dispose();
});

test("sprint retains Rapier collision, capsule size, and diagonal speed limits", async () => {
  await initWorldPhysics();
  const environment = environmentSchema.parse({ ...DEFAULT_ENVIRONMENT, spawn: [0, 0.01, 0], physics: { colliders: [
    { position: [0, -0.5, 0], halfExtents: [12, 0.5, 12], quaternion: [0, 0, 0, 1] },
    { position: [2, 1, 0], halfExtents: [0.025, 1, 5], quaternion: [0, 0, 0, 1] },
  ] } });
  const room = new WorldRoom("sprint", environment); room.join("a", "Runner");
  for (let i = 0; i < 40; i++) {
    room.command("a", { type: "move", direction: [1, 0], yaw: 0, sequence: i, sprint: true }, i * 50);
    room.tick(0.05, i * 50);
    assert(room.snapshot().players[0].position[0] < 1.71, "Sprint must not tunnel through a thin wall");
  }
  room.dispose();
});

test("emotes have server-owned identity and timing, stop movement, replay, and expire", () => {
  const room = new WorldRoom(); room.join("a", "Alice"); room.join("b", "Bob");
  room.command("a", { type: "move", direction: [1, 0], yaw: 0, sequence: 5, sprint: true }, 0);
  const feet = room.snapshot().players[0].position;
  room.command("a", { type: "emote", name: "wave" }, 0);
  const first = room.snapshot().players[0].emote!;
  room.command("a", { type: "move", direction: [1, 0], yaw: 0, sequence: 4 }, 0);
  room.tick(0.1, 0);
  assert.equal(room.snapshot().players[0].emote!.id, first.id, "A stale move must not cancel a gesture");
  assert.deepEqual(room.snapshot().players[0].position, feet);
  assert.equal(room.snapshot().players[1].emote, undefined);
  room.command("a", { type: "emote", name: "wave" }, 100);
  assert(room.snapshot().players[0].emote!.id > first.id);
  room.command("a", { type: "move", direction: [0, 0], yaw: 0, sequence: 6 }, 100);
  for (let i = 0; i < 50; i++) room.tick(0.05, 100 + 50 * i);
  assert.equal(room.snapshot().players[0].emote, null);
  for (const name of EMOTE_NAMES) {
    room.command("a", { type: "emote", name });
    const snapshot = room.dynamicSnapshot();
    assert.equal(snapshot.players[0].emote!.name, name);
    for (let elapsed = 0; elapsed < EMOTES[name].duration + 0.1; elapsed += 0.05) room.tick(0.05);
    assert.equal(room.snapshot().players[0].emote, null);
  }
  room.command("a", { type: "emote", name: "bow" });
  room.command("a", { type: "move", direction: [0, 1], yaw: 0, sequence: 7, sprint: true }, 10000);
  assert.equal(room.snapshot().players[0].emote, null);
  room.tick(0.05, 10000); assert.equal(room.snapshot().players[0].animation, "run"); room.dispose();
});

test("commands reject forged gesture/speed state and encounters cancel or block emotes", () => {
  for (const command of [
    { type: "emote", name: "teleport" }, { type: "emote", name: "bow", id: 999 },
    { type: "emote", name: "wave", elapsed: -1 },
    { type: "move", direction: [1, 0], yaw: 0, sequence: 0, sprint: 10 },
    { type: "move", direction: [1, 0], yaw: 0, sequence: 0, speed: 99 },
  ]) assert.equal(commandSchema.safeParse(command).success, false);
  const room = new WorldRoom("nearby", { ...DEFAULT_ENVIRONMENT, spawn: [-3, 0, 1] }); room.join("a", "Alice");
  room.command("a", { type: "emote", name: "bow" });
  room.command("a", { type: "interact", npcId: "cafe_owner" });
  assert.equal(room.snapshot().players[0].emote, null);
  assert.match(room.command("a", { type: "emote", name: "wave" })!, /conversation/);
  const position = room.snapshot().players[0].position;
  room.command("a", { type: "move", direction: [1, 0], yaw: 0, sequence: 0, sprint: true }); room.tick(0.1);
  assert.deepEqual(room.snapshot().players[0].position, position); room.dispose();
});

const key = (name: string, code = name, patch: Partial<InputKey> = {}): InputKey => ({ key: name, code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, target: null, preventDefault() {}, ...patch });
test("world input handles either Shift, releases both correctly, and clears every held key", () => {
  const input = new PlayerInput();
  input.keyDown(key("Shift", "ShiftLeft")); input.keyDown(key("W", "KeyW", { shiftKey: true }));
  assert.equal(input.sprinting, true); assert.deepEqual(input.direction, [0, -1]);
  input.keyDown(key("Shift", "ShiftRight")); input.keyUp(key("Shift", "ShiftLeft")); assert.equal(input.sprinting, true);
  input.keyUp(key("Shift", "ShiftRight")); assert.equal(input.sprinting, false); assert.deepEqual(input.direction, [0, -1]);
  input.keyDown(key("Shift", "ShiftLeft")); input.clear(); assert.equal(input.sprinting, false); assert.deepEqual(input.direction, [0, 0]);
});
test("emote shortcut ignores typing, composition and modifiers; repeated G does not reopen it", () => {
  const input = new PlayerInput();
  assert.equal(input.keyDown(key("g", "KeyG")), "emotes");
  for (const patch of [{ repeat: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { target: { closest: () => ({}) } as unknown as Element }]) {
    assert.equal(input.keyDown(key("g", "KeyG", patch)), undefined);
  }
  assert.equal(input.keyDown(key("v", "KeyV")), "view");
  assert.equal(input.keyDown(key("e", "KeyE")), "interact");
});
