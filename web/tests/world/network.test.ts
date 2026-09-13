import test from "node:test";
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { createRoomServer } from "../../lib/world/dev-server";
import { serverMessageSchema, type ServerMessage, type RoomSnapshot } from "../../lib/world/schema";

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
  const message = [...peer.messages].reverse().find((m) => m.type === "snapshot" || m.type === "welcome");
  return message && "snapshot" in message ? message.snapshot : undefined;
}
test("real websocket clients share movement and disconnects, with room isolation", async () => {
  const server = createRoomServer(); const port = await server.listen(0);
  const a = client(`ws://127.0.0.1:${port}/world`), b = client(`ws://127.0.0.1:${port}/world`), c = client(`ws://127.0.0.1:${port}/world`);
  try {
    await until(() => [a, b, c].every((p) => p.socket.readyState === WebSocket.OPEN));
    for (const [peer, roomId, name] of [[a, "shared", "Alice"], [b, "shared", "Bob"], [c, "other", "Other"]] as const) peer.send({ type: "join", protocol: 1, roomId, name });
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
    peer.send({ type: "join", protocol: 1, roomId: "room", name: "Alice", playerId: "impersonated" });
    assert.equal(await closed, 1002);
  } finally { peer.socket.terminate(); await server.close(); }
});

test("two networked players join an encounter, arbitrate turns and release disconnected speaker", async () => {
  const server = createRoomServer(); const port = await server.listen(0);
  const a = client(`ws://127.0.0.1:${port}/world`), b = client(`ws://127.0.0.1:${port}/world`);
  let movement: ReturnType<typeof setInterval> | undefined;
  try {
    await until(() => [a, b].every((p) => p.socket.readyState === WebSocket.OPEN));
    for (const [peer, name] of [[a, "Alice"], [b, "Bob"]] as const) peer.send({ type: "join", protocol: 1, roomId: "shared", name });
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
