import { DurableObject } from "cloudflare:workers";
import { WorldRoom } from "../lib/world/room";
import { initWorldPhysics } from "../lib/world/physics";
import { KYOTO_ENVIRONMENT, KYOTO_NPCS } from "../lib/world/kyoto";
import { clientMessageSchema, MAX_ROOM_PLAYERS, PROTOCOL_VERSION, type ServerMessage } from "../lib/world/schema";
import { verifyWorldTicket, type WorldTicket } from "../lib/world/hosted-ticket";

import { PlayerVoiceRoom, VoiceBudget } from "./player-voice";
import { playerVoiceClientSchema, VOICE_ENVELOPE_LIMIT, type PlayerVoiceServerMessage } from "../lib/world/player-voice-contract";

type Env = KyotoWorkerEnv;
interface Peer { voiceBudget: VoiceBudget; playerId: string; joined: boolean; claims: WorldTicket; lastSeen: number; window: number; messages: number; actions: number; connectedAt: number }
const reject = (message: string, status: number) => Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });

/** Every room name maps to one authoritative object worldwide. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") return Response.json({ service: "kyoto-shared-world", protocol: PROTOCOL_VERSION, capacity: MAX_ROOM_PLAYERS });
    if (url.pathname !== "/world") return reject("Not found", 404);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return reject("WebSocket required", 426);
    const origin = request.headers.get("origin") ?? "";
    if (!(env.WORLD_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).includes(origin)) return reject("Open Kyoto Conversations to play", 403);
    const protocols = (request.headers.get("sec-websocket-protocol") ?? "").split(",").map((p) => p.trim());
    if (protocols.length !== 2 || protocols[0] !== `kyoto-v${PROTOCOL_VERSION}`) return reject("Join the world from the game", 401);
    const claims = await verifyWorldTicket(protocols[1], env.WORLD_TICKET_SECRET, origin);
    if (!claims) return reject("Join ticket expired. Reconnect from the game.", 401);
    // Guests have no durable identity. This generous network ceiling permits a
    // shared hackathon Wi-Fi while bounding automated room creation per location.
    const network = request.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await env.WORLD_ADMISSION.limit({ key: `kyoto-admission:${network}` })).success) return reject("Too many joins. Please wait a minute and reconnect.", 429);
    const room = env.KYOTO_ROOMS.getByName(claims.roomId);
    const headers = new Headers(request.headers);
    // Overwrite any caller-supplied internal claims. Only this Worker signs admission.
    headers.set("x-kyoto-claims", JSON.stringify(claims));
    headers.delete("sec-websocket-protocol");
    return room.fetch(new Request(request, { headers }));
  },
} satisfies ExportedHandler<Env>;

/** Live room state stays with its connections. Empty rooms release their simulation.
 * Service restarts reconnect guests cleanly; this MVP does not persist world progress.
 */
export class KyotoRoom extends DurableObject<Env> {
  private room?: WorldRoom;
  private roomId?: string;
  private peers = new Map<WebSocket, Peer>();
  private voice = new PlayerVoiceRoom();
  private timer?: ReturnType<typeof setInterval>;
  private previous = performance.now();
  private publishedRevision = -1;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS used_tickets (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
    ctx.storage.sql.exec("CREATE INDEX IF NOT EXISTS used_tickets_expiry ON used_tickets(expires_at)");
  }
  async fetch(request: Request): Promise<Response> {
    await initWorldPhysics();
    const claims = JSON.parse(request.headers.get("x-kyoto-claims") ?? "null") as WorldTicket | null;
    if (!claims || request.headers.get("upgrade")?.toLowerCase() !== "websocket") return reject("Invalid room admission", 403);
    const now = Date.now();
    this.ctx.storage.sql.exec("DELETE FROM used_tickets WHERE expires_at <= ?", now);
    if (claims.expiresAt <= now) return reject("Join ticket expired", 401);
    if (this.peers.size >= MAX_ROOM_PLAYERS) return reject("This room is full. Choose another room name.", 429);
    if (this.roomId && this.roomId !== claims.roomId) return reject("Wrong room", 403);
    this.roomId = claims.roomId;
    this.room ??= new WorldRoom(claims.roomId, KYOTO_ENVIRONMENT, KYOTO_NPCS);
    // Synchronous SQLite admission survives a restart and cannot race another join.
    const admitted = this.ctx.storage.sql.exec("INSERT INTO used_tickets(nonce, expires_at) VALUES (?, ?) ON CONFLICT(nonce) DO NOTHING RETURNING nonce", claims.nonce, claims.expiresAt).toArray();
    if (!admitted.length) return reject("Join ticket already used", 401);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const peer: Peer = { voiceBudget: new VoiceBudget(), playerId: `player_${claims.playerId}`, joined: false, claims, lastSeen: now, window: now, messages: 0, actions: 0, connectedAt: now };
    this.peers.set(server, peer);
    server.addEventListener("message", (event) => this.message(server, peer, event.data));
    server.addEventListener("close", () => this.remove(server));
    server.addEventListener("error", () => this.remove(server));
    this.startTicking();
    return new Response(null, { status: 101, webSocket: client, headers: { "Sec-WebSocket-Protocol": `kyoto-v${PROTOCOL_VERSION}` } });
  }
  private message(socket: WebSocket, peer: Peer, raw: string | ArrayBuffer) {
    const now = Date.now();
    peer.lastSeen = now;
    if (now - peer.window >= 1000) { peer.window = now; peer.messages = 0; peer.actions = 0; }
    if (!this.peers.has(socket)) return;
    if (typeof raw !== "string" || raw.length > VOICE_ENVELOPE_LIMIT) return this.close(socket, 1002, "Invalid message");
    if (!peer.voiceBudget.admit(new TextEncoder().encode(raw).byteLength, now)) return this.close(socket, 1008, "Too much traffic");
    if (raw === "ping") {
      if (++peer.messages > 80) return this.close(socket, 1008, "Too many messages");
      socket.send("pong"); return;
    }
    let parsed;
    try {
      const data: unknown = JSON.parse(raw);
      const type = data && typeof data === "object" && "type" in data ? data.type : undefined;
      if (typeof type === "string" && type.startsWith("npc-")) {
        if (++peer.messages > 80) return this.close(socket, 1008, "Too many messages");
        if (!peer.joined) return this.close(socket, 1008, "Join first");
        this.send(socket, { type: "voice-error", message: "NPC voice is unavailable on this server." }); return;
      }
      if (typeof type === "string" && type.startsWith("voice-")) {
        const voice = playerVoiceClientSchema.safeParse(data);
        if (!voice.success) return this.close(socket, 1002, "Invalid voice protocol");
        if (!peer.joined) return this.close(socket, 1008, "Join first");
        if (!peer.voiceBudget.allow(voice.data, now)) return this.close(socket, 1008, "Too many voice messages");
        this.deliverVoice(this.voice.handle(peer.playerId, voice.data, this.room!.dynamicSnapshot().players)); return;
      }
      if (raw.length > 4096) return this.close(socket, 1002, "Invalid message");
      if (++peer.messages > 80) return this.close(socket, 1008, "Too many messages");
      parsed = clientMessageSchema.safeParse(data);
    }
    catch { return this.close(socket, 1002, "Invalid JSON"); }
    if (!parsed.success) return this.close(socket, 1002, "Invalid protocol");
    const message = parsed.data;
    if (message.type === "join") {
      if (peer.joined || message.roomId.toLowerCase() !== peer.claims.roomId || message.name !== peer.claims.name) return this.close(socket, 1008, "Invalid room admission");
      try { this.room!.join(peer.playerId, peer.claims.name); }
      catch { return this.close(socket, 1008, "This room is full. Choose another room."); }
      peer.joined = true;
      this.send(socket, { type: "welcome", playerId: peer.playerId, snapshot: this.room!.snapshot() });
      return;
    }
    if (!peer.joined) return this.close(socket, 1008, "Join first");
    if (message.command.type !== "move" && ++peer.actions > 10) return this.close(socket, 1008, "Too many actions");
    const error = this.room!.command(peer.playerId, message.command);
    if (error) this.send(socket, { type: "error", message: error });
  }
  private send(socket: WebSocket, message: ServerMessage | PlayerVoiceServerMessage) {
    try { socket.send(JSON.stringify(message)); } catch { this.remove(socket); }
  }
  private deliverVoice(deliveries: ReturnType<PlayerVoiceRoom["refresh"]>) {
    for (const delivery of deliveries) {
      const target = [...this.peers].find(([,p]) => p.joined && p.playerId === delivery.to);
      if (target) this.send(target[0], delivery.message);
    }
  }
  private publish() {
    if (!this.room) return;
    this.deliverVoice(this.voice.refresh(this.room.dynamicSnapshot().players));
    if (!this.room) return;
    this.publishedRevision = this.room.snapshotRevision;
    const encoded = JSON.stringify({ type: "state", ...this.room.dynamicSnapshot() });
    for (const [socket, peer] of this.peers) if (peer.joined) {
      try { socket.send(encoded); } catch { this.remove(socket); }
    }
  }
  private close(socket: WebSocket, code: number, reason: string) {
    this.send(socket, { type: "error", message: reason });
    try { socket.close(code, reason); } catch { /* Already disconnected. */ }
    this.remove(socket);
  }
  private remove(socket: WebSocket) {
    const peer = this.peers.get(socket);
    if (!peer) return;
    this.peers.delete(socket);
    this.voice.remove(peer.playerId);
    if (peer.joined) this.room?.leave(peer.playerId);
    if (this.room) this.deliverVoice(this.voice.refresh(this.room.dynamicSnapshot().players));
    if (!this.peers.size) {
      clearInterval(this.timer); this.timer = undefined;
      this.room?.dispose(); this.room = undefined;
      this.publishedRevision = -1;
    }
  }
  private startTicking() {
    if (this.timer) return;
    this.previous = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now(), wallClock = Date.now();
      for (const [socket, peer] of this.peers) {
        if ((!peer.joined && wallClock - peer.connectedAt > 12000) || wallClock - peer.lastSeen > 45000) this.close(socket, 1001, "Connection expired");
      }
      if (!this.room) return;
      this.room.tick((now - this.previous) / 1000, now); this.previous = now;
      // Coalesce movement, joins, departures and actions into at most 20 broadcasts/s.
      if (this.room.snapshotRevision !== this.publishedRevision) this.publish();
    }, 50);
  }
}
