import { WorldRoom } from "./room";
import { PROTOCOL_VERSION, serverMessageSchema, type ServerMessage, type WorldCommand, type EnvironmentManifest, type NpcSnapshot } from "./schema";

export type ConnectionState = "connecting" | "connected" | "disconnected";
export interface WorldTransport {
  readonly mode: "local" | "multiplayer";
  connect(options: { roomId: string; name: string; onMessage: (message: ServerMessage) => void; onConnection: (state: ConnectionState) => void }): () => void;
  send(command: WorldCommand): void;
}

/** Isolated preview: never presented as a networked room. Create one per provider. */
export function createLocalTransport(options: { environment?: EnvironmentManifest; npcs?: NpcSnapshot[] } = {}): WorldTransport {
  let send: WorldTransport["send"] = () => {};
  return {
    mode: "local",
    connect({ roomId, name, onMessage, onConnection }) {
      const room = new WorldRoom(roomId, options.environment, options.npcs);
      const playerId = `player_${crypto.randomUUID()}`;
      room.join(playerId, name);
      onConnection("connected");
      onMessage({ type: "welcome", playerId, snapshot: room.snapshot() });
      let lastRevision = -1;
      const publish = () => {
        const snapshot = room.snapshot();
        if (snapshot.revision !== lastRevision) { lastRevision = snapshot.revision; onMessage({ type: "snapshot", snapshot }); }
      };
      send = (command) => {
        const message = room.command(playerId, command);
        if (message) onMessage({ type: "error", message });
        publish();
      };
      const timer = setInterval(() => { room.tick(0.05); publish(); }, 50);
      return () => { clearInterval(timer); send = () => {}; onConnection("disconnected"); };
    },
    send(command) { send(command); },
  };
}

/** No silent offline fallback: a disconnected room cannot continue accepting actions.
 * Reconnect rejoins as a fresh guest; identity/session resumption belongs to auth.
 */
export function createWebSocketTransport(url: string): WorldTransport {
  let socket: WebSocket | undefined;
  return {
    mode: "multiplayer",
    connect({ roomId, name, onMessage, onConnection }) {
      let stopped = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let attempts = 0;
      const open = () => {
        if (stopped) return;
        onConnection("connecting");
        let current: WebSocket;
        try { current = new WebSocket(url); socket = current; }
        catch { onMessage({ type: "error", message: "Invalid multiplayer server address" }); onConnection("disconnected"); return; }
        current.onopen = () => current.send(JSON.stringify({ type: "join", protocol: PROTOCOL_VERSION, roomId, name }));
        current.onmessage = (event) => {
          if (stopped || current !== socket) return;
          try {
            const parsed = serverMessageSchema.safeParse(JSON.parse(event.data));
            if (!parsed.success) throw new Error("protocol");
            if (parsed.data.type === "welcome") { attempts = 0; onConnection("connected"); }
            onMessage(parsed.data);
          } catch {
            onMessage({ type: "error", message: "Incompatible multiplayer server message" });
            current.close(1002, "Invalid protocol");
          }
        };
        current.onerror = () => onMessage({ type: "error", message: "Multiplayer connection unavailable" });
        current.onclose = (event) => {
          if (stopped || current !== socket) return;
          onConnection("disconnected");
          if ([1002, 1008].includes(event.code)) return;
          retry = setTimeout(open, Math.min(1000 * 2 ** attempts++, 10000));
        };
      };
      open();
      return () => { stopped = true; clearTimeout(retry); socket?.close(); socket = undefined; };
    },
    send(command) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "command", command })); },
  };
}
