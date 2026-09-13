import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRoomServer } from "../../lib/world/dev-server";
import { PROTOCOL_VERSION, serverMessageSchema, type ServerMessage, type RoomSnapshot } from "../../lib/world/schema";
import { KYOTO_ENVIRONMENT, KYOTO_NPCS } from "../../lib/world/kyoto";
import { CHARACTER_PRESETS } from "../../lib/characters/presets";

function client(url: string) {
  const socket = new WebSocket(url, { origin: "http://localhost:5173" });
  const messages: ServerMessage[] = [];
  socket.on("message", (data) => messages.push(serverMessageSchema.parse(JSON.parse(data.toString()))));
  return { socket, messages, send(data: unknown) { socket.send(JSON.stringify(data)); } };
}
async function until<T>(read: () => T | undefined | false): Promise<T> {
  const end = Date.now() + 4000;
  while (Date.now() < end) { const result = read(); if (result) return result; await new Promise((resolve) => setTimeout(resolve, 20)); }
  throw new Error("Timed out waiting for network state");
}
function latest(peer: ReturnType<typeof client>): RoomSnapshot | undefined {
  const reversed = [...peer.messages].reverse();
  const message = reversed.find((m) => m.type === "snapshot" || m.type === "welcome" || m.type === "state");
  if (!message) return;
  if ("snapshot" in message) return message.snapshot;
  const welcome = reversed.find((m) => m.type === "welcome");
  if (message.type !== "state" || welcome?.type !== "welcome") return;
  return {
    protocol: message.protocol, roomId: message.roomId, revision: message.revision,
    environment: welcome.snapshot.environment, players: message.players, npcs: message.npcs, encounters: message.encounters, vehicles: message.vehicles,
  };
}
test("real websocket clients share movement and disconnects, with room isolation", async () => {
  const server = createRoomServer(); const port = await server.listen(0);
  const a = client(`ws://127.0.0.1:${port}/world`), b = client(`ws://127.0.0.1:${port}/world`), c = client(`ws://127.0.0.1:${port}/world`);
  try {
    await until(() => [a, b, c].every((p) => p.socket.readyState === WebSocket.OPEN));
    for (const [peer, roomId, name] of [[a, "shared", "Alice"], [b, "shared", "Bob"], [c, "other", "Other"]] as const) peer.send({ type: "join", protocol: PROTOCOL_VERSION, roomId, name });
    await until(() => latest(a)?.players.length === 2 && latest(b)?.players.length === 2 && latest(c)?.players.length === 1);
    const welcome = a.messages.find((m) => m.type === "welcome"); assert.ok(welcome?.type === "welcome");
    a.send({ type: "command", command: { type: "move", direction: [1, 0], yaw: 1, sequence: 0 } });
    await until(() => (latest(b)?.players.find((p) => p.id === welcome.playerId)?.position[0] ?? 0) > 0);
    assert.equal(latest(c)?.players.length, 1);
    a.socket.close();
    await until(() => latest(b)?.players.length === 1);
    assert.equal(latest(b)?.players[0].name, "Bob");
  } finally { for (const peer of [a, b, c]) peer.socket.terminate(); await server.close(); }
});
test("server rejects incompatible protocol and client-authored identity", async () => {
  const server = createRoomServer(); const port = await server.listen(0);
  const peer = client(`ws://127.0.0.1:${port}/world`);
  try {
    await until(() => peer.socket.readyState === WebSocket.OPEN);
    const closed = new Promise<number>((resolve) => peer.socket.once("close", resolve));
    peer.send({ type: "join", protocol: PROTOCOL_VERSION, roomId: "room", name: "Alice", playerId: "impersonated" });
    assert.equal(await closed, 1002);
  } finally { peer.socket.terminate(); await server.close(); }
});

test("two networked players join an encounter, arbitrate turns and release disconnected speaker", async () => {
  const server = createRoomServer(); const port = await server.listen(0);
  const a = client(`ws://127.0.0.1:${port}/world`), b = client(`ws://127.0.0.1:${port}/world`);
  let movement: ReturnType<typeof setInterval> | undefined;
  try {
    await until(() => [a, b].every((p) => p.socket.readyState === WebSocket.OPEN));
    for (const [peer, name] of [[a, "Alice"], [b, "Bob"]] as const) peer.send({ type: "join", protocol: PROTOCOL_VERSION, roomId: "shared", name });
    await until(() => latest(a)?.players.length === 2 && latest(b)?.players.length === 2);
    let sequence = 0;
    movement = setInterval(() => { for (const peer of [a, b]) peer.send({ type: "command", command: { type: "move", direction: [-0.6, -0.8], yaw: 0, sequence } }); sequence++; }, 50);
    await until(() => latest(a)?.players.every((p) => Math.hypot(p.position[0] + 3, p.position[2]) < 2.3));
    clearInterval(movement);
    for (const peer of [a, b]) peer.send({ type: "command", command: { type: "move", direction: [0, 0], yaw: 0, sequence } });
    a.send({ type: "command", command: { type: "interact", npcId: "cafe_owner" } });
    const encounter = await until(() => latest(b)?.encounters[0]);
    b.send({ type: "command", command: { type: "join-encounter", encounterId: encounter.id } });
    await until(() => latest(a)?.encounters[0]?.participantIds.length === 2);
    a.send({ type: "command", command: { type: "claim-turn", encounterId: encounter.id } });
    await until(() => latest(b)?.encounters[0]?.speakerId);
    b.send({ type: "command", command: { type: "claim-turn", encounterId: encounter.id } });
    await until(() => b.messages.some((m) => m.type === "error" && m.message.includes("speaking")));
    a.socket.close();
    await until(() => latest(b)?.encounters[0]?.participantIds.length === 1 && latest(b)?.encounters[0]?.speakerId === null);
    b.send({ type: "command", command: { type: "leave-encounter" } });
    await until(() => latest(b)?.encounters.length === 0);
  } finally { clearInterval(movement); a.socket.terminate(); b.socket.terminate(); await server.close(); }
});

test("city clients share exact player cosmetics while live updates omit the static physics manifest", async () => {
  const server = createRoomServer({ environment: KYOTO_ENVIRONMENT, npcs: KYOTO_NPCS });
  const port = await server.listen(0);
  const a = client(`ws://127.0.0.1:${port}/world`), b = client(`ws://127.0.0.1:${port}/world`);
  try {
    await until(() => [a, b].every((peer) => peer.socket.readyState === WebSocket.OPEN));
    for (const [peer, name] of [[a, "Alice"], [b, "Bob"]] as const) peer.send({ type: "join", protocol: PROTOCOL_VERSION, roomId: "city", name });
    await until(() => latest(a)?.players.length === 2 && latest(b)?.players.length === 2);
    const alice = a.messages.find((message) => message.type === "welcome");
    const bob = b.messages.find((message) => message.type === "welcome");
    assert.ok(alice?.type === "welcome" && bob?.type === "welcome");
    const aliceLook = { ...CHARACTER_PRESETS.cafe_owner.appearance, top: "#123abc", height: 1.91 };
    const bobLook = { ...CHARACTER_PRESETS.inn_host.appearance, glasses: false, bag: true, accent: "#abcdef" };
    a.send({ type: "command", command: { type: "set-appearance", appearance: aliceLook } });
    b.send({ type: "command", command: { type: "set-appearance", appearance: bobLook } });
    await until(() => latest(b)?.players.find((player) => player.id === alice.playerId)?.appearance.top === aliceLook.top && latest(a)?.players.find((player) => player.id === bob.playerId)?.appearance.accent === bobLook.accent);
    for (const peer of [a, b]) {
      assert.deepEqual(latest(peer)?.players.find((player) => player.id === alice.playerId)?.appearance, aliceLook);
      assert.deepEqual(latest(peer)?.players.find((player) => player.id === bob.playerId)?.appearance, bobLook);
      const updates = peer.messages.filter((message) => message.type === "state");
      assert(updates.length > 0);
      assert(!peer.messages.some((message) => message.type === "snapshot"));
      for (const update of updates) {
        assert(!("environment" in update));
        assert.equal(update.environmentRevision, KYOTO_ENVIRONMENT.revision);
        assert.equal(update.npcs.length, 15);
        assert(Buffer.byteLength(JSON.stringify(update)) < 16 * 1024, "A city state update must stay below 16 KiB");
      }
    }
    assert.deepEqual(alice.snapshot.environment, KYOTO_ENVIRONMENT, "The initial welcome must carry the complete city manifest");
    const beforeMove = latest(b)!.revision;
    a.send({ type: "command", command: { type: "move", direction: [1, 0], yaw: 1, sequence: 0 } });
    await until(() => latest(b)!.revision > beforeMove);
    assert.equal(a.messages.filter((message) => message.type === "welcome").length, 1);
    assert.equal(b.messages.filter((message) => message.type === "welcome").length, 1);
  } finally { a.socket.terminate(); b.socket.terminate(); await server.close(); }
});
