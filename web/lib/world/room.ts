import { DEFAULT_ENVIRONMENT, DEFAULT_NPCS } from "./defaults";
import { commandSchema, environmentSchema, npcSchema, playerSchema, roomSchema, PROTOCOL_VERSION, type EnvironmentManifest, type NpcSnapshot, type RoomSnapshot, type Vec3 } from "./schema";

export const PLAYER_RADIUS = 0.3;
const SPEED = 3;
export function distance(a: Vec3, b: Vec3) { return Math.hypot(...a.map((v, i) => v - b[i])); }

/** Small authoritative room kernel shared by the local preview and dev server.
 * Deliberately supports a flat walkable floor + AABB obstacles, not a full physics engine.
 */
export class WorldRoom {
  private state: RoomSnapshot;
  private inputs = new Map<string, { x: number; z: number; yaw: number; sequence: number; receivedAt: number }>();
  private nextEncounter = 0;
  constructor(roomId = "courtyard", environment: EnvironmentManifest = DEFAULT_ENVIRONMENT, npcs: NpcSnapshot[] = DEFAULT_NPCS) {
    const manifest = environmentSchema.parse(environment);
    const resolved = npcs.map((npc) => npcSchema.parse({ ...npc, position: manifest.npcSpawns[npc.id] ?? npc.position }));
    if (new Set(resolved.map((npc) => npc.id)).size !== resolved.length) throw new Error("NPC IDs must be unique");
    this.state = roomSchema.parse({ protocol: PROTOCOL_VERSION, roomId, revision: 0, environment: manifest, players: [], npcs: resolved, encounters: [] });
    if (!this.canStand(manifest.spawn)) throw new Error("Player spawn overlaps a collider or boundary");
  }
  snapshot(): RoomSnapshot { return structuredClone(this.state); }
  private changed() { this.state.revision++; }
  join(playerId: string, name: string) {
    if (this.state.players.some((p) => p.id === playerId)) throw new Error("Player already joined");
    if (this.state.players.length >= 8) throw new Error("Room is full");
    this.state.players.push(playerSchema.parse({ id: playerId, name: name.trim(), position: [...this.state.environment.spawn], yaw: 0, animation: "idle" }));
    this.changed();
  }
  leave(playerId: string) {
    this.leaveEncounter(playerId);
    this.state.players = this.state.players.filter((p) => p.id !== playerId);
    this.inputs.delete(playerId);
    this.changed();
  }
  private leaveEncounter(playerId: string) {
    for (const encounter of this.state.encounters) {
      encounter.participantIds = encounter.participantIds.filter((id) => id !== playerId);
      if (encounter.speakerId === playerId) encounter.speakerId = null;
      if (encounter.ownerId === playerId) encounter.ownerId = encounter.participantIds[0] ?? playerId;
    }
    this.state.encounters = this.state.encounters.filter((e) => e.participantIds.length > 0);
  }
  command(playerId: string, raw: unknown, now = performance.now()): string | null {
    const result = commandSchema.safeParse(raw);
    if (!result.success) return "Invalid world command";
    const command = result.data;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return "Join a room first";
    const active = this.state.encounters.find((e) => e.participantIds.includes(playerId));
    if (command.type === "move") {
      const previous = this.inputs.get(playerId);
      if (previous && command.sequence <= previous.sequence) return null;
      this.inputs.set(playerId, { x: active ? 0 : command.direction[0], z: active ? 0 : command.direction[1], yaw: command.yaw, sequence: command.sequence, receivedAt: now });
      return null;
    }
    if (command.type === "leave-encounter") {
      this.leaveEncounter(playerId); this.changed(); return null;
    }
    if (command.type === "interact") {
      if (active) return "Leave your current encounter first";
      const npc = this.state.npcs.find((n) => n.id === command.npcId);
      if (!npc) return "Unknown character";
      if (distance(player.position, npc.position) > npc.interactionRadius) return "Move closer to the character";
      if (this.state.encounters.some((e) => e.npcId === npc.id)) return "Character is busy; join their encounter";
      this.state.encounters.push({ id: `encounter_${++this.nextEncounter}`, npcId: npc.id, ownerId: playerId, participantIds: [playerId], speakerId: null });
      this.inputs.delete(playerId); player.animation = "idle"; this.changed(); return null;
    }
    const encounter = this.state.encounters.find((e) => e.id === command.encounterId);
    if (!encounter) return "Encounter is no longer available";
    if (command.type === "join-encounter") {
      if (active) return "Leave your current encounter first";
      const npc = this.state.npcs.find((n) => n.id === encounter.npcId)!;
      if (distance(player.position, npc.position) > npc.interactionRadius) return "Move closer to join";
      encounter.participantIds.push(playerId); this.inputs.delete(playerId); player.animation = "idle";
    } else {
      if (!encounter.participantIds.includes(playerId)) return "You are not in this encounter";
      if (command.type === "claim-turn") {
        if (encounter.speakerId && encounter.speakerId !== playerId) return "Another learner is speaking";
        encounter.speakerId = playerId;
      } else if (encounter.speakerId === playerId) encounter.speakerId = null;
    }
    this.changed(); return null;
  }
  private canStand(position: Vec3) {
    const { bounds, colliders } = this.state.environment;
    if (position[0] < bounds.min[0] + PLAYER_RADIUS || position[0] > bounds.max[0] - PLAYER_RADIUS || position[2] < bounds.min[2] + PLAYER_RADIUS || position[2] > bounds.max[2] - PLAYER_RADIUS) return false;
    return !colliders.some(({ min, max }) => position[1] < max[1] && position[1] + 1.7 > min[1] && position[0] > min[0] - PLAYER_RADIUS && position[0] < max[0] + PLAYER_RADIUS && position[2] > min[2] - PLAYER_RADIUS && position[2] < max[2] + PLAYER_RADIUS);
  }
  tick(deltaSeconds: number, now = performance.now()) {
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.1);
    if (!Number.isFinite(dt)) return;
    let changed = false;
    for (const player of this.state.players) {
      const input = this.inputs.get(player.id);
      const canMove = input && now - input.receivedAt < 300 && !this.state.encounters.some((e) => e.participantIds.includes(player.id));
      const length = canMove ? Math.hypot(input.x, input.z) : 0;
      const old = [...player.position];
      if (canMove && length > 0) {
        const step = SPEED * dt / Math.max(1, length);
        for (const [axis, amount] of [[0, input.x * step], [2, input.z * step]] as const) {
          const next: Vec3 = [...player.position]; next[axis] += amount;
          if (this.canStand(next)) player.position = next;
        }
      }
      const animation = old.some((v, i) => v !== player.position[i]) ? "walk" : "idle";
      const yaw = input?.yaw ?? player.yaw;
      if (animation !== player.animation || yaw !== player.yaw || animation === "walk") changed = true;
      player.animation = animation; player.yaw = yaw;
    }
    if (changed) this.changed();
  }
}
