import type { PlayerVoiceClientMessage, PlayerVoiceServerMessage } from "./player-voice-contract";
import type { RoomSnapshot, ServerMessage, WorldCommand } from "./schema";
import type { ConnectionState, WorldTransport } from "./transport";
import type { WorldClockAnchor } from "./world-clock";

export interface WorldState {
  snapshot: RoomSnapshot | null;
  worldClock: WorldClockAnchor | null;
  localPlayerId: string | null;
  connection: ConnectionState;
  mode: WorldTransport["mode"];
  supportsPlayerVoice: boolean;
  latencyMs: number | null;
  error: string | null;
}
export function createWorldStore(transport: WorldTransport, now = () => performance.now()) {
  let state: WorldState = { snapshot: null, worldClock: null, localPlayerId: null, connection: "disconnected", mode: transport.mode, supportsPlayerVoice: transport.supportsPlayerVoice === true, latencyMs: null, error: null };
  const initial = state;
  const listeners = new Set<() => void>();
  let sequence = 0;
  const update = (patch: Partial<WorldState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
  const anchorClock = (sample: RoomSnapshot["worldClock"]): WorldClockAnchor | null => sample ? { sample, receivedAtMs: now(), latencyMs: state.latencyMs } : null;
  const receive = (message: ServerMessage) => {
    if (message.type === "error") return update({ error: message.message });
    if (message.type === "welcome") { sequence = 0; return update({ snapshot: message.snapshot, worldClock: anchorClock(message.snapshot.worldClock), localPlayerId: message.playerId, error: null }); }
    if (message.type === "state") {
      const previous = state.snapshot;
      if (!state.localPlayerId || !previous || message.protocol !== previous.protocol || message.roomId !== previous.roomId || message.environmentRevision !== previous.environment.revision || message.revision <= previous.revision) return;
      return update({ worldClock: message.worldClock ? anchorClock(message.worldClock) : state.worldClock, snapshot: {
        protocol: message.protocol, roomId: message.roomId, revision: message.revision,
        environment: previous.environment, players: message.players, npcs: message.npcs, encounters: message.encounters, vehicles: message.vehicles,
        worldClock: message.worldClock ?? previous.worldClock,
      } });
    }
    if (!state.localPlayerId || !state.snapshot || message.snapshot.roomId !== state.snapshot.roomId || message.snapshot.revision <= state.snapshot.revision) return;
    update({ snapshot: message.snapshot, worldClock: message.snapshot.worldClock ? anchorClock(message.snapshot.worldClock) : state.worldClock });
  };
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(roomId: string, name: string) {
      update({ snapshot: null, worldClock: null, localPlayerId: null, connection: "connecting", latencyMs: null, error: null });
      try {
        return transport.connect({ roomId, name, onMessage: receive, onLatency: (latencyMs) => update({ latencyMs, worldClock: state.worldClock ? { ...state.worldClock, latencyMs } : null }), onConnection: (connection) => update(connection === "connected" ? { connection } : { connection, snapshot: null, worldClock: null, localPlayerId: null, latencyMs: null }) });
      } catch {
        update({ connection: "disconnected", error: "Unable to join this room. Check the room and display name." });
        return () => {};
      }
    },
    send(command: WorldCommand) {
      if (state.connection !== "connected" || !state.localPlayerId) return;
      if (command.type === "move") {
        const sentSequence = sequence++;
        transport.send({ ...command, sequence: sentSequence });
        return sentSequence;
      }
      transport.send(command);
    },
    sendVoice(message: PlayerVoiceClientMessage) { if (state.supportsPlayerVoice && state.connection === "connected" && state.localPlayerId) transport.sendVoice?.(message); },
    subscribeVoice(listener: (message: PlayerVoiceServerMessage) => void) { return state.supportsPlayerVoice ? transport.subscribeVoice?.(listener) ?? (() => {}) : () => {}; },
    clearError() { update({ error: null }); },
  };
}
