import test from "node:test";
import assert from "node:assert/strict";
import { createWorldStore } from "../../lib/world/store";
import { WorldRoom } from "../../lib/world/room";
import type { WorldTransport } from "../../lib/world/transport";
import type { WorldCommand } from "../../lib/world/schema";

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
