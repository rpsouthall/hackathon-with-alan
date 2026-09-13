import test from "node:test";
import assert from "node:assert/strict";
import { createWorldStore } from "../../lib/world/store";
import { WorldRoom } from "../../lib/world/room";
import type { WorldTransport } from "../../lib/world/transport";
import { serverMessageSchema, type WorldCommand, type ServerMessage } from "../../lib/world/schema";

test("store rejects stale and cross-room snapshots; disconnect blocks commands", () => {
  let receiver: Parameters<WorldTransport["connect"]>[0] | undefined;
  const sent: WorldCommand[] = [];
  const transport: WorldTransport = { mode: "multiplayer", connect(options) { receiver = options; return () => {}; }, send(command) { sent.push(command); } };
  const store = createWorldStore(transport); store.connect("one", "Alice");
  store.send({ type: "leave-encounter" }); assert.equal(sent.length, 0);
  const room = new WorldRoom("one"); room.join("a", "Alice");
  receiver!.onConnection("connected"); receiver!.onMessage({ type: "welcome", playerId: "a", snapshot: room.snapshot() });
  const initial = store.getSnapshot();
  receiver!.onMessage({ type: "snapshot", snapshot: { ...room.snapshot(), revision: 0 } });
  assert.equal(store.getSnapshot(), initial);
  receiver!.onMessage({ type: "snapshot", snapshot: { ...room.snapshot(), roomId: "two", revision: 100 } });
  assert.equal(store.getSnapshot(), initial);
  store.send({ type: "move", direction: [1, 0], yaw: 0, sequence: 999 });
  store.send({ type: "move", direction: [0, 0], yaw: 0, sequence: 999 });
  assert.equal((sent[0] as { sequence: number }).sequence, 0);
  assert.equal((sent[1] as { sequence: number }).sequence, 1);
  receiver!.onConnection("disconnected");
  store.send({ type: "leave-encounter" });
  assert.equal(sent.length, 2); assert.equal(store.getSnapshot().snapshot, null);
});

test("compact state keeps the welcome environment and ignores stale, mismatched and pre-welcome updates", () => {
  let receiver: Parameters<WorldTransport["connect"]>[0] | undefined;
  const transport: WorldTransport = { mode: "multiplayer", connect(options) { receiver = options; return () => {}; }, send() {} };
  const store = createWorldStore(transport);
  store.connect("one", "Alice");
  const room = new WorldRoom("one");
  room.join("a", "Alice");
  const sendState = (patch: Partial<Extract<ServerMessage, { type: "state" }>> = {}) => receiver!.onMessage({ type: "state", ...room.dynamicSnapshot(), ...patch });
  const beforeWelcome = store.getSnapshot();
  sendState();
  assert.equal(store.getSnapshot(), beforeWelcome);
  receiver!.onConnection("connected");
  const welcome = room.snapshot();
  receiver!.onMessage({ type: "welcome", playerId: "a", snapshot: welcome });
  const initial = store.getSnapshot();
  sendState(); // Same revision as welcome is redundant.
  sendState({ revision: 0 });
  sendState({ revision: 100, roomId: "other" });
  sendState({ revision: 100, environmentRevision: "other-release" });
  assert.equal(store.getSnapshot(), initial);
  room.join("b", "Bob");
  sendState();
  assert.equal(store.getSnapshot().snapshot?.players.length, 2);
  assert.equal(store.getSnapshot().snapshot?.environment, welcome.environment);
  assert.equal(store.getSnapshot().snapshot?.revision, room.snapshotRevision);
  const accepted = store.getSnapshot();
  sendState({ revision: initial.snapshot!.revision });
  assert.equal(store.getSnapshot(), accepted);
  receiver!.onConnection("disconnected");
  sendState({ revision: 1000 });
  assert.equal(store.getSnapshot().snapshot, null);
  room.dispose();
});

test("compact state schema excludes a repeated environment and room snapshots remain isolated", () => {
  const room = new WorldRoom("one");
  room.join("a", "Alice");
  const dynamic = room.dynamicSnapshot();
  assert(serverMessageSchema.safeParse({ type: "state", ...dynamic }).success);
  assert(!serverMessageSchema.safeParse({ type: "state", ...dynamic, environment: room.snapshot().environment }).success);
  dynamic.players[0].position[0] = 999;
  dynamic.players[0].appearance.top = "#abcdef";
  assert.notEqual(room.snapshot().players[0].position[0], 999);
  assert.notEqual(room.snapshot().players[0].appearance.top, "#abcdef");
  room.dispose();
});
