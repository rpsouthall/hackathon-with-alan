import { playerVoiceServerSchema, type PlayerVoiceClientMessage, type PlayerVoiceServerMessage } from "./player-voice-contract";
import { WorldRoom } from "./room";
import { initWorldPhysics } from "./physics";
import { PROTOCOL_VERSION, serverMessageSchema, type ServerMessage, type WorldCommand, type EnvironmentManifest, type NpcSnapshot } from "./schema";

export type ConnectionState = "connecting" | "connected" | "disconnected";
export interface WorldTransport {
  /** Explicit opt-in: the Node development server accepts gameplay messages only. */
  readonly supportsPlayerVoice?: boolean;
  sendVoice?(message: PlayerVoiceClientMessage): void;
  subscribeVoice?(listener: (message: PlayerVoiceServerMessage) => void): () => void;
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
      let stopped = false;
      let room: WorldRoom | undefined;
      let timer: ReturnType<typeof setInterval> | undefined;
      onConnection("connecting");
      const start = async () => {
        try {
          if (options.environment?.physics) await initWorldPhysics();
          if (stopped) return;
          room = new WorldRoom(roomId, options.environment, options.npcs);
          const playerId = `player_${crypto.randomUUID()}`;
          room.join(playerId, name);
          onConnection("connected");
          onMessage({ type: "welcome", playerId, snapshot: room.snapshot() });
          let lastRevision = room.snapshotRevision;
          const publish = () => {
            if (!room || stopped) return;
            if (room.snapshotRevision !== lastRevision) {
              lastRevision = room.snapshotRevision;
              onMessage({ type: "state", ...room.dynamicSnapshot() });
            }
          };
          send = (command) => {
            if (!room || stopped) return;
            const message = room.command(playerId, command);
            if (message) onMessage({ type: "error", message });
            publish();
          };
          let previous = performance.now();
          timer = setInterval(() => { const now = performance.now(); room?.tick((now - previous) / 1000, now); previous = now; publish(); }, 50);
        } catch {
          room?.dispose();
          if (!stopped) {
            onMessage({ type: "error", message: "The local world could not initialize. Reload to try again." });
            onConnection("disconnected");
          }
        }
      };
      void start();
      return () => { stopped = true; clearInterval(timer); room?.dispose(); send = () => {}; onConnection("disconnected"); };
    },
    send(command) { send(command); },
  };
}

/** Each reconnect obtains a fresh short-lived join ticket from this Site. */
export function createHostedTransport(): WorldTransport {
  return createWebSocketTransport(async ({ roomId, name, signal }) => {
    const response = await fetch("/api/world/join", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ roomId, name }), signal,
    });
    const result = await response.json() as { url?: string; ticket?: string; error?: string };
    if (!response.ok || !result.url || !result.ticket) throw new Error(result.error ?? "The shared world is unavailable. Please try again.");
    return { url: result.url, protocols: [`kyoto-v${PROTOCOL_VERSION}`, result.ticket] };
  }, true, { playerVoice: true });
}

type SocketAddress = string | ((options: { roomId: string; name: string; signal: AbortSignal }) => Promise<{ url: string; protocols: string[] }>);

/** No silent offline fallback. Reconnection is automatic and rejoins as a fresh guest. */
export function createWebSocketTransport(address: SocketAddress, heartbeat = false, capabilities: { playerVoice?: boolean } = {}): WorldTransport {
  let socket: WebSocket | undefined;
  const supportsPlayerVoice = capabilities.playerVoice === true;
  const voiceListeners = new Set<(message: PlayerVoiceServerMessage) => void>();
  return {
    mode: "multiplayer",
    supportsPlayerVoice,
    connect({ roomId, name, onMessage, onConnection }) {
      let stopped = false;
      let retry: ReturnType<typeof setTimeout> | undefined;
      let attempts = 0;
      const lifecycle = new AbortController();
      const open = async () => {
        if (stopped) return;
        onConnection("connecting");
        let current: WebSocket;
        try {
          const destination = typeof address === "string" ? { url: address, protocols: undefined } : await address({ roomId, name, signal: lifecycle.signal });
          if (stopped) return;
          current = new WebSocket(destination.url, destination.protocols); socket = current;
        } catch (error) {
          if (stopped) return;
          onMessage({ type: "error", message: error instanceof Error ? error.message.slice(0, 300) : "Unable to connect to the shared world" });
          onConnection("disconnected");
          retry = setTimeout(open, Math.min(1000 * 2 ** attempts++, 15000));
          return;
        }
        let lastMessage = Date.now();
        let keepalive: ReturnType<typeof setInterval> | undefined;
        const welcomeTimeout = setTimeout(() => current.close(4000, "Join timed out"), 12000);
        current.onopen = () => {
          current.send(JSON.stringify({ type: "join", protocol: PROTOCOL_VERSION, roomId, name }));
          if (heartbeat) keepalive = setInterval(() => {
            if (Date.now() - lastMessage > 45000) current.close(4000, "Connection timed out");
            else if (current.readyState === WebSocket.OPEN) current.send("ping");
          }, 15000);
        };
        current.onmessage = (event) => {
          if (stopped || current !== socket) return;
          lastMessage = Date.now();
          if (heartbeat && event.data === "pong") return;
          try {
            const data: unknown = JSON.parse(event.data);
            const voice = playerVoiceServerSchema.safeParse(data);
            if (voice.success) {
              for (const listener of voiceListeners) {
                try { listener(voice.data); } catch { console.warn("A voice listener could not process an update"); }
              }
              return;
            }
            const parsed = serverMessageSchema.safeParse(data);
            if (!parsed.success) throw new Error("protocol");
            if (parsed.data.type === "welcome") { clearTimeout(welcomeTimeout); attempts = 0; onConnection("connected"); }
            onMessage(parsed.data);
          } catch {
            onMessage({ type: "error", message: "Incompatible multiplayer server message" });
            current.close(1002, "Invalid protocol");
          }
        };
        current.onerror = () => { if (!stopped) onMessage({ type: "error", message: "The shared world connection was interrupted. Reconnecting…" }); };
        current.onclose = (event) => {
          clearTimeout(welcomeTimeout); clearInterval(keepalive);
          if (stopped || current !== socket) return;
          onConnection("disconnected");
          if ([1002, 1008].includes(event.code)) return;
          retry = setTimeout(open, Math.min(1000 * 2 ** attempts++, 10000));
        };
      };
      void open();
      return () => { stopped = true; lifecycle.abort(); clearTimeout(retry); socket?.close(); socket = undefined; };
    },
    subscribeVoice(listener) { if (!supportsPlayerVoice) return () => {}; voiceListeners.add(listener); return () => { voiceListeners.delete(listener); }; },
    sendVoice(message) { if (supportsPlayerVoice && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); },
    send(command) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "command", command })); },
  };
}
