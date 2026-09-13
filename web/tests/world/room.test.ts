import test from "node:test";
import assert from "node:assert/strict";
import { WorldRoom } from "../../lib/world/room";
import { DEFAULT_ENVIRONMENT, DEFAULT_NPCS } from "../../lib/world/defaults";
import { environmentSchema, commandSchema, MAX_ROOM_PLAYERS } from "../../lib/world/schema";
import { voiceAccess } from "../../lib/world/voice-contract";

function nearbyRoom() {
  return new WorldRoom("test", { ...DEFAULT_ENVIRONMENT, spawn: [-3, 0, 1] });
}
test("two players share one NPC encounter with exclusive speaking turns", () => {
  const room = nearbyRoom(); room.join("a", "Alice"); room.join("b", "Bob");
  assert.equal(room.command("a", { type: "interact", npcId: "cafe_owner" }), null);
  assert.match(room.command("b", { type: "interact", npcId: "cafe_owner" })!, /busy/);
  const encounterId = room.snapshot().encounters[0].id;
  assert.equal(room.command("b", { type: "join-encounter", encounterId }), null);
  assert.equal(room.command("a", { type: "claim-turn", encounterId }), null);
  assert.match(room.command("b", { type: "claim-turn", encounterId })!, /speaking/);
  assert.equal(voiceAccess(room.snapshot(), "a")?.canTransmit, true);
  assert.equal(voiceAccess(room.snapshot(), "b")?.canTransmit, false);
  assert.equal(voiceAccess(room.snapshot(), "outsider"), null);
  room.command("b", { type: "release-turn", encounterId });
  assert.equal(room.snapshot().encounters[0].speakerId, "a");
  room.leave("a");
  assert.equal(room.snapshot().encounters[0].ownerId, "b");
  assert.equal(room.snapshot().encounters[0].speakerId, null);
  assert.equal(room.command("b", { type: "claim-turn", encounterId }), null);
  room.leave("b");
  assert.deepEqual(room.snapshot().encounters, []);
});
test("rejects remote interaction, unknown NPCs and forged ownership", () => {
  const room = new WorldRoom(); room.join("a", "Alice");
  assert.match(room.command("a", { type: "interact", npcId: "cafe_owner" })!, /closer/);
  assert.match(room.command("a", { type: "interact", npcId: "missing" })!, /Unknown/);
  assert.match(room.command("a", { type: "claim-turn", encounterId: "missing", playerId: "b" })!, /Invalid/);
  assert.match(room.command("unknown", { type: "leave-encounter" })!, /Join/);
});
test("movement cannot teleport, exceed speed, leave bounds or pass walls", () => {
  const room = new WorldRoom("test", { ...DEFAULT_ENVIRONMENT, spawn: [0, 0, 0], colliders: [{ min: [1, -1, -2], max: [2, 2, 2] }] });
  room.join("a", "Alice");
  assert.equal(commandSchema.safeParse({ type: "move", position: [999, 0, 999], direction: [1, 0], yaw: 0, sequence: 0 }).success, false);
  for (let i = 0; i < 40; i++) { room.command("a", { type: "move", direction: [1, 0], yaw: 0, sequence: i }, i * 50); room.tick(0.05, i * 50); }
  assert.ok(room.snapshot().players[0].position[0] <= 0.7);
  const before = room.snapshot().players[0].position;
  room.tick(30, 9999); assert.deepEqual(room.snapshot().players[0].position, before, "stale input expires");
  const free = new WorldRoom(); free.join("b", "Bob");
  free.command("b", { type: "move", direction: [1, 1], yaw: 0, sequence: 1 }, 0); free.tick(0.1, 0);
  assert.ok(Math.hypot(free.snapshot().players[0].position[0], free.snapshot().players[0].position[2] - 4) <= 0.30001);
  free.command("b", { type: "move", direction: [-1, -1], yaw: 0, sequence: 0 }, 0); free.tick(0.1, 0);
  assert.ok(free.snapshot().players[0].position[0] > 0, "old movement sequence ignored");
  for (let i = 2; i < 300; i++) { free.command("b", { type: "move", direction: [1, 1], yaw: 0, sequence: i }, i * 50); free.tick(0.05, i * 50); }
  const final = free.snapshot().players[0].position;
  assert.ok(final[0] <= 11.7 && final[2] <= 11.7);
});
test("encounter freezes movement and duplicate membership is rejected", () => {
  const room = nearbyRoom(); room.join("a", "Alice");
  room.command("a", { type: "interact", npcId: "cafe_owner" });
  const before = room.snapshot().players[0].position;
  room.command("a", { type: "move", direction: [1, 0], yaw: 0, sequence: 0 }, 0); room.tick(0.1, 0);
  assert.deepEqual(room.snapshot().players[0].position, before);
  assert.match(room.command("a", { type: "join-encounter", encounterId: room.snapshot().encounters[0].id })!, /Leave/);
});
test("environment replacement preserves logical NPC identity", () => {
  const environment = { ...DEFAULT_ENVIRONMENT, revision: "art-v2", assetUrl: "/models/kyoto.glb", npcSpawns: { ...DEFAULT_ENVIRONMENT.npcSpawns, cafe_owner: [7, 0, 4] as [number, number, number] } };
  const room = new WorldRoom("test", environment);
  assert.deepEqual(room.snapshot().npcs.find((n) => n.id === "cafe_owner")?.position, [7, 0, 4]);
  assert.equal(room.snapshot().npcs[0].scenarioId, DEFAULT_NPCS[0].scenarioId);
  assert.equal(environmentSchema.safeParse({ ...environment, assetUrl: "javascript:alert(1)" }).success, false);
  assert.equal(environmentSchema.safeParse({ ...environment, spawn: [1000, 0, 0] }).success, false);
});
test("snapshots cannot mutate authority and rooms enforce capacity", () => {
  const room = new WorldRoom();
  for (let i = 0; i < MAX_ROOM_PLAYERS; i++) room.join(`p${i}`, `Player ${i}`);
  assert.throws(() => room.join("overflow", "Full"), /full/);
  const snapshot = room.snapshot(); snapshot.players[0].position[0] = 9000;
  assert.equal(room.snapshot().players[0].position[0], 0);
});
