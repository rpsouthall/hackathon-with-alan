import type { RoomSnapshot, ServerMessage, WorldCommand } from "./schema";
import type { ConnectionState, WorldTransport } from "./transport";

export interface WorldState {
  snapshot: RoomSnapshot | null;
  localPlayerId: string | null;
  connection: ConnectionState;
  mode: WorldTransport["mode"];
  error: string | null;
}
export function createWorldStore(transport: WorldTransport) {
  let state: WorldState = { snapshot: null, localPlayerId: null, connection: "disconnected", mode: transport.mode, error: null };
  const initial = state;
  const listeners = new Set<() => void>();
  let sequence = 0;
  const update = (patch: Partial<WorldState>) => { state = { ...state, ...patch }; listeners.forEach((listener) => listener()); };
  const receive = (message: ServerMessage) => {
    if (message.type === "error") return update({ error: message.message });
    if (message.type === "welcome") { sequence = 0; return update({ snapshot: message.snapshot, localPlayerId: message.playerId, error: null }); }
    if (!state.localPlayerId || !state.snapshot || message.snapshot.roomId !== state.snapshot.roomId || message.snapshot.revision <= state.snapshot.revision) return;
    update({ snapshot: message.snapshot });
  };
  return {
    getSnapshot: () => state,
    getServerSnapshot: () => initial,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    connect(roomId: string, name: string) {
      update({ snapshot: null, localPlayerId: null, connection: "connecting", error: null });
      try {
        return transport.connect({ roomId, name, onMessage: receive, onConnection: (connection) => update(connection === "connected" ? { connection } : { connection, snapshot: null, localPlayerId: null }) });
      } catch {
        update({ connection: "disconnected", error: "Unable to join this room. Check the room and display name." });
        return () => {};
      }
    },
    send(command: WorldCommand) {
      if (state.connection !== "connected" || !state.localPlayerId) return;
      transport.send(command.type === "move" ? { ...command, sequence: sequence++ } : command);
    },
    clearError() { update({ error: null }); },
  };
}
