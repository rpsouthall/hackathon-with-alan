import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import { WorldRoom } from "./room";
import { clientMessageSchema, type ServerMessage } from "./schema";

/** Single-process guest server for integration testing and local demos.
 * Not part of the Sites Worker: deploy an authenticated room service for production.
 */
export function createRoomServer({ origins = ["http://localhost:5173", "http://127.0.0.1:5173"], maxRooms = 32 } = {}) {
  const rooms = new Map<string, WorldRoom>();
  const peers = new Map<WebSocket, { playerId: string; roomId: string | null; alive: boolean; count: number; window: number; joinedAt: number }>();
  const http = createServer((_request, response) => { response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify({ service: "world-dev-server", protocol: 1 })); });
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 4096 });
  http.on("upgrade", (request, socket, head) => {
    if (request.url !== "/world" || !request.headers.origin || !origins.includes(request.headers.origin) || peers.size >= 128) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); socket.destroy(); return;
    }
    sockets.handleUpgrade(request, socket, head, (ws) => sockets.emit("connection", ws, request));
  });
  const send = (socket: WebSocket, message: ServerMessage) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 256 * 1024) { socket.close(1008, "Slow consumer"); return; }
    socket.send(JSON.stringify(message));
  };
  const publish = (roomId: string) => {
    const room = rooms.get(roomId); if (!room) return;
    const snapshot = room.snapshot();
    for (const [socket, peer] of peers) if (peer.roomId === roomId) send(socket, { type: "snapshot", snapshot });
  };
  sockets.on("connection", (socket) => {
    const peer = { playerId: `player_${randomUUID()}`, roomId: null as string | null, alive: true, count: 0, window: Date.now(), joinedAt: Date.now() };
    peers.set(socket, peer);
    socket.on("pong", () => { peer.alive = true; });
    socket.on("error", () => { socket.terminate(); });
    socket.on("message", (raw, binary) => {
      const now = Date.now();
      if (now - peer.window >= 1000) { peer.count = 0; peer.window = now; }
      if (++peer.count > 80) { socket.close(1008, "Rate limit"); return; }
      let parsed;
      try { parsed = clientMessageSchema.safeParse(binary ? null : JSON.parse(raw.toString())); }
      catch { socket.close(1002, "Malformed JSON"); return; }
      if (!parsed.success) { socket.close(1002, "Invalid protocol"); return; }
      const message = parsed.data;
      if (message.type === "join") {
        if (peer.roomId) { socket.close(1008, "Already joined"); return; }
        let room = rooms.get(message.roomId);
        if (!room) {
          if (rooms.size >= maxRooms) { send(socket, { type: "error", message: "Server is full" }); socket.close(1008); return; }
          room = new WorldRoom(message.roomId); rooms.set(message.roomId, room);
        }
        try { room.join(peer.playerId, message.name); }
        catch { send(socket, { type: "error", message: "Room is full" }); socket.close(1008); return; }
        peer.roomId = message.roomId;
        send(socket, { type: "welcome", playerId: peer.playerId, snapshot: room.snapshot() });
        publish(peer.roomId); return;
      }
      if (!peer.roomId) { socket.close(1008, "Join first"); return; }
      const error = rooms.get(peer.roomId)!.command(peer.playerId, message.command);
      if (error) send(socket, { type: "error", message: error });
      if (message.command.type !== "move") publish(peer.roomId);
    });
    socket.on("close", () => {
      peers.delete(socket);
      if (!peer.roomId) return;
      const room = rooms.get(peer.roomId); room?.leave(peer.playerId);
      if (!room?.snapshot().players.length) rooms.delete(peer.roomId);
      else publish(peer.roomId);
    });
  });
  let previous = performance.now();
  const tick = setInterval(() => {
    const now = performance.now(), delta = (now - previous) / 1000; previous = now;
    for (const [roomId, room] of rooms) {
      const revision = room.snapshot().revision; room.tick(delta, now);
      if (room.snapshot().revision !== revision) publish(roomId);
    }
  }, 50);
  const heartbeat = setInterval(() => {
    for (const [socket, peer] of peers) {
      if (!peer.alive || (!peer.roomId && Date.now() - peer.joinedAt > 10000)) { socket.terminate(); continue; }
      peer.alive = false; socket.ping();
    }
  }, 10000);
  return {
    listen(port = 8788, host = "127.0.0.1") {
      return new Promise<number>((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, host, () => { http.removeListener("error", reject); const address = http.address(); resolve(typeof address === "object" && address ? address.port : port); });
      });
    },
    async close() {
      clearInterval(tick); clearInterval(heartbeat);
      for (const socket of peers.keys()) socket.terminate();
      await new Promise<void>((resolve) => sockets.close(() => resolve()));
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
