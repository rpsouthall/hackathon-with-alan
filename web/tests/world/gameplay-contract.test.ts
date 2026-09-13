import test from "node:test";
import assert from "node:assert/strict";
import { WorldRoom } from "../../lib/world/room";
import { DEFAULT_ENVIRONMENT, DEFAULT_NPCS } from "../../lib/world/defaults";
import { MAX_ROOM_PLAYERS, PROTOCOL_VERSION, clientMessageSchema, roomSchema, roomStateSchema, serverMessageSchema } from "../../lib/world/schema";

test("gameplay protocol 2 keeps voice envelopes outside its parser", () => {
  assert.equal(PROTOCOL_VERSION, 2);
  const join = { type: "join", protocol: PROTOCOL_VERSION, roomId: "gameplay", name: "Learner" };
  assert.equal(clientMessageSchema.safeParse(join).success, true);
  assert.equal(clientMessageSchema.safeParse({ ...join, protocol: 1 }).success, false);
  assert.equal(clientMessageSchema.safeParse({ type: "voice-signal", targetId: "other", signal: {} }).success, false);
  assert.equal(serverMessageSchema.safeParse({ type: "voice-state", participants: [] }).success, false);
});

test("32-player shared encounters preserve non-owner turns and owner handoff", () => {
  assert.equal(MAX_ROOM_PLAYERS, 32);
  const room = new WorldRoom("capacity", { ...DEFAULT_ENVIRONMENT, spawn: [-3, 0, 1] });
  try {
    for (let i = 0; i < MAX_ROOM_PLAYERS; i++) room.join(`p${i}`, `Player ${i}`);
    assert.equal(room.command("p0", { type: "interact", npcId: "cafe_owner" }), null);
    const encounterId = room.snapshot().encounters[0].id;
    assert.equal(room.snapshot().encounters[0].speakerId, null);
    for (let i = 1; i < MAX_ROOM_PLAYERS; i++) assert.equal(room.command(`p${i}`, { type: "join-encounter", encounterId }), null);
    assert.equal(room.snapshot().encounters[0].participantIds.length, MAX_ROOM_PLAYERS);
    assert.equal(roomSchema.safeParse(room.snapshot()).success, true);
    assert.equal(roomStateSchema.safeParse(room.dynamicSnapshot()).success, true);
    assert.equal(room.command("p2", { type: "claim-turn", encounterId }), null, "A learner can speak without owning the encounter");
    assert.equal(room.command("p0", { type: "leave-encounter" }), null);
    assert.equal(room.snapshot().encounters[0].ownerId, "p1");
    assert.equal(room.snapshot().encounters[0].speakerId, "p2", "An unrelated owner departure preserves the speaker");
    room.leave("p2");
    assert.equal(room.snapshot().encounters[0].speakerId, null);
    assert.equal(room.command("p31", { type: "claim-turn", encounterId }), null);
    assert.throws(() => room.join("p1", "Duplicate"), /already/);
  } finally { room.dispose(); }
});

test("all 32 players can reserve separate NPCs under the same gameplay schema", () => {
  const npcs = Array.from({ length: MAX_ROOM_PLAYERS }, (_, index) => ({ ...DEFAULT_NPCS[0], id: `npc_${index}` }));
  const room = new WorldRoom("parallel", { ...DEFAULT_ENVIRONMENT, spawn: [-3, 0, 1] }, npcs);
  try {
    for (let i = 0; i < MAX_ROOM_PLAYERS; i++) {
      room.join(`p${i}`, `Player ${i}`);
      assert.equal(room.command(`p${i}`, { type: "interact", npcId: `npc_${i}` }), null);
    }
    assert.equal(room.snapshot().encounters.length, MAX_ROOM_PLAYERS);
    assert.equal(roomSchema.safeParse(room.snapshot()).success, true);
    assert.throws(() => room.join("overflow", "Full"), /full/);
  } finally { room.dispose(); }
});
