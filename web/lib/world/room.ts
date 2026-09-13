import { DEFAULT_ENVIRONMENT, DEFAULT_NPCS } from "./defaults";
import { commandSchema, environmentSchema, npcSchema, playerSchema, roomSchema, PROTOCOL_VERSION, MAX_ROOM_PLAYERS, type EnvironmentManifest, type NpcSnapshot, type PlayerSnapshot, type RoomSnapshot, type RoomStateSnapshot, type Vec3, type VehicleSnapshot } from "./schema";
import { RoomPhysics, PHYSICS_TIMESTEP, type ActorProfile } from "./physics";
import { EMOTES, WALK_SPEED, SPRINT_SPEED } from "./player-actions";
import { VEHICLE_CONFIG, VEHICLE_MOUNT_DISTANCE } from "./vehicle-contract";

export const PLAYER_RADIUS = 0.3;
export function distance(a: Vec3, b: Vec3) { return Math.hypot(...a.map((v, i) => v - b[i])); }

/** Authoritative room shared by local preview and multiplayer. Exported physics
 * metadata enables Rapier; the tiny blockout retains its flat AABB fallback. */
export class WorldRoom {
  private state: RoomSnapshot;
  private inputs = new Map<string, { x: number; z: number; yaw: number; sequence: number; receivedAt: number; sprint: boolean }>();
  private nextEncounter = 0;
  private nextEmote = 0;
  private physics?: RoomPhysics;
  private vehicleMotion = new Map<string, { speed: number; x: number; z: number }>();
  private disposed = false;
  constructor(roomId = "courtyard", environment: EnvironmentManifest = DEFAULT_ENVIRONMENT, npcs: NpcSnapshot[] = DEFAULT_NPCS) {
    const manifest = environmentSchema.parse(environment);
    const resolved = npcs.map((npc) => npcSchema.parse({ ...npc, yaw: npc.yaw ?? 0, position: manifest.npcSpawns[npc.id] ?? npc.position }));
    if (new Set(resolved.map((npc) => npc.id)).size !== resolved.length) throw new Error("NPC IDs must be unique");
    this.state = roomSchema.parse({ protocol: PROTOCOL_VERSION, roomId, revision: 0, environment: manifest, players: [], npcs: resolved, encounters: [],
      vehicles: (manifest.vehicleSpawns ?? []).map((spawn) => ({ ...spawn, riderId: null, speed: 0 })) });
    if (manifest.physics) this.physics = new RoomPhysics(manifest);
    else if (!this.canStand(manifest.spawn)) throw new Error("Player spawn overlaps a collider or boundary");
    for (const vehicle of this.state.vehicles) {
      const supported = this.supportedPosition(vehicle.position, this.vehicleProfile(vehicle));
      if (!supported) { this.physics?.dispose(); throw new Error(`Vehicle ${vehicle.id} has no clear supported parking position`); }
      vehicle.position = supported;
    }
  }
  snapshot(): RoomSnapshot { return structuredClone(this.state); }
  get snapshotRevision(): number { return this.state.revision; }
  get playerCount(): number { return this.state.players.length; }
  dynamicSnapshot(): RoomStateSnapshot {
    const { environment, ...dynamic } = this.state;
    return structuredClone({ ...dynamic, environmentRevision: environment.revision });
  }
  private changed() { this.state.revision++; }
  join(playerId: string, name: string) {
    if (this.disposed) throw new Error("Room is closed");
    if (this.state.players.some((p) => p.id === playerId)) throw new Error("Player already joined");
    if (this.state.players.length >= MAX_ROOM_PLAYERS) throw new Error("Room is full");
    const player = playerSchema.parse({ id: playerId, name: name.trim(), position: [...this.state.environment.spawn], yaw: 0, animation: "idle" });
    this.physics?.join(playerId, player.position);
    this.state.players.push(player);
    this.changed();
  }
  leave(playerId: string) {
    if (this.disposed) return;
    this.leaveEncounter(playerId);
    const vehicle = this.state.vehicles.find((item) => item.riderId === playerId);
    if (vehicle) { vehicle.riderId = null; vehicle.speed = 0; this.vehicleMotion.delete(vehicle.id); }
    this.state.players = this.state.players.filter((p) => p.id !== playerId);
    this.inputs.delete(playerId);
    this.physics?.leave(playerId);
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
    if (this.disposed) return "Room is closed";
    const result = commandSchema.safeParse(raw);
    if (!result.success) return "Invalid world command";
    const command = result.data;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return "Join a room first";
    if (command.type === "set-appearance") {
      player.appearance = command.appearance; this.changed(); return null;
    }
    const active = this.state.encounters.find((e) => e.participantIds.includes(playerId));
    if (command.type === "mount-vehicle") {
      if (player.vehicleId) return "Dismount your current vehicle first";
      if (active) return "Finish your conversation before riding";
      const vehicle = this.state.vehicles.find((item) => item.id === command.vehicleId);
      if (!vehicle) return "Unknown vehicle";
      if (vehicle.riderId) return "This vehicle already has a rider; choose another";
      if (distance(player.position, vehicle.position) > VEHICLE_MOUNT_DISTANCE) return "Move within 2 metres of the vehicle to ride";
      const position = this.supportedPosition(vehicle.position, this.vehicleProfile(vehicle));
      if (!position || !this.canReach(player.position, position)) return "The vehicle is blocked; approach it from the open street";
      if (this.physics && !this.physics.setProfile(playerId, position, this.vehicleProfile(vehicle))) return "There is not enough room to mount here";
      player.vehicleId = vehicle.id; player.position = [...position]; player.yaw = vehicle.yaw; player.animation = "idle"; player.emote = null;
      vehicle.riderId = playerId; vehicle.position = [...position]; vehicle.speed = 0;
      this.vehicleMotion.set(vehicle.id, { speed: 0, x: Math.sin(vehicle.yaw), z: Math.cos(vehicle.yaw) });
      this.inputs.delete(playerId); this.changed(); return null;
    }
    if (command.type === "dismount-vehicle") {
      const vehicle = this.state.vehicles.find((item) => item.id === player.vehicleId && item.riderId === playerId);
      if (!vehicle) return "You are not riding a vehicle";
      vehicle.speed = 0; this.vehicleMotion.delete(vehicle.id); this.inputs.delete(playerId);
      const position = this.dismountPosition(playerId, vehicle);
      this.changed();
      if (!position) return "No safe place to dismount. Move to an open street and try again";
      if (this.physics && !this.physics.setProfile(playerId, position)) return "Dismount is blocked. Move to an open street and try again";
      vehicle.riderId = null; player.vehicleId = null; player.position = position; player.animation = "idle";
      return null;
    }
    if (player.vehicleId && ["emote", "interact", "join-encounter", "claim-turn", "release-turn"].includes(command.type)) {
      return command.type === "emote" ? "Dismount before using an emote" : "Dismount before starting or joining a conversation";
    }
    if (command.type === "emote") {
      if (active) return "Finish your conversation before using an emote";
      const input = this.inputs.get(playerId);
      if (input) { input.x = 0; input.z = 0; input.sprint = false; }
      player.animation = "idle";
      player.emote = { name: command.name, id: ++this.nextEmote, elapsed: 0 };
      this.changed(); return null;
    }
    if (command.type === "move") {
      const previous = this.inputs.get(playerId);
      if (previous && command.sequence <= previous.sequence) return null;
      this.inputs.set(playerId, { x: active ? 0 : command.direction[0], z: active ? 0 : command.direction[1], yaw: command.yaw, sequence: command.sequence, receivedAt: now, sprint: !active && !!command.sprint });
      if (!active && player.emote && command.direction.some((value) => value !== 0)) { player.emote = null; this.changed(); }
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
      this.inputs.delete(playerId); player.animation = "idle"; player.emote = null; this.changed(); return null;
    }
    const encounter = this.state.encounters.find((e) => e.id === command.encounterId);
    if (!encounter) return "Encounter is no longer available";
    if (command.type === "join-encounter") {
      if (active) return "Leave your current encounter first";
      const npc = this.state.npcs.find((n) => n.id === encounter.npcId)!;
      if (distance(player.position, npc.position) > npc.interactionRadius) return "Move closer to join";
      encounter.participantIds.push(playerId); this.inputs.delete(playerId); player.animation = "idle"; player.emote = null;
    } else {
      if (!encounter.participantIds.includes(playerId)) return "You are not in this encounter";
      if (command.type === "claim-turn") {
        if (encounter.speakerId && encounter.speakerId !== playerId) return "Another learner is speaking";
        encounter.speakerId = playerId;
      } else if (encounter.speakerId === playerId) encounter.speakerId = null;
    }
    this.changed(); return null;
  }
  private vehicleProfile(vehicle: VehicleSnapshot): ActorProfile { return { ...VEHICLE_CONFIG[vehicle.kind], vehicle: true }; }
  private canStand(position: Vec3, profile: ActorProfile = { radius: PLAYER_RADIUS, height: 1.7 }) {
    if (this.physics) return this.physics.canStand(position, profile);
    const { bounds, colliders } = this.state.environment;
    if (!position.every(Number.isFinite) || position[1] < bounds.min[1] || position[1] + profile.height > bounds.max[1]
      || position[0] < bounds.min[0] + profile.radius || position[0] > bounds.max[0] - profile.radius || position[2] < bounds.min[2] + profile.radius || position[2] > bounds.max[2] - profile.radius) return false;
    return !colliders.some(({ min, max }) => position[1] < max[1] && position[1] + profile.height > min[1] && position[0] > min[0] - profile.radius && position[0] < max[0] + profile.radius && position[2] > min[2] - profile.radius && position[2] < max[2] + profile.radius);
  }
  private supportedPosition(position: Vec3, profile?: ActorProfile): Vec3 | null {
    if (this.physics) return this.physics.supportedPosition(position, profile);
    const ground = this.state.environment.spawn[1];
    if (Math.abs(position[1] - ground) > 0.45) return null;
    const supported: Vec3 = [position[0], ground, position[2]];
    return this.canStand(supported, profile) ? supported : null;
  }
  private canReach(from: Vec3, to: Vec3): boolean {
    if (this.physics) return this.physics.canReach(from, to);
    const count = Math.max(1, Math.ceil(distance(from, to) / 0.08));
    for (let i = 0; i <= count; i++) if (!this.canStand(from.map((value, axis) => value + (to[axis] - value) * i / count) as Vec3)) return false;
    return true;
  }
  private dismountPosition(playerId: string, vehicle: VehicleSnapshot): Vec3 | null {
    const base = VEHICLE_CONFIG[vehicle.kind].radius + PLAYER_RADIUS + 0.17;
    for (const radius of [base, base + 0.40]) {
      for (const angle of [Math.PI / 2, -Math.PI / 2, Math.PI, 0, Math.PI / 4, -Math.PI / 4, Math.PI * 3 / 4, -Math.PI * 3 / 4]) {
        const yaw = vehicle.yaw + angle;
        const candidate = this.supportedPosition([vehicle.position[0] + Math.sin(yaw) * radius, vehicle.position[1], vehicle.position[2] + Math.cos(yaw) * radius]);
        if (!candidate || !this.canReach(vehicle.position, candidate)) continue;
        if (this.state.players.some((other) => other.id !== playerId && Math.abs(other.position[1] - candidate[1]) < 1.7
          && Math.hypot(other.position[0] - candidate[0], other.position[2] - candidate[2]) < PLAYER_RADIUS * 2 + 0.05)) continue;
        if (this.state.vehicles.some((other) => other.id !== vehicle.id && Math.abs(other.position[1] - candidate[1]) < 1.9
          && Math.hypot(other.position[0] - candidate[0], other.position[2] - candidate[2]) < VEHICLE_CONFIG[other.kind].radius + PLAYER_RADIUS + 0.05)) continue;
        return candidate;
      }
    }
    return null;
  }
  private driveVelocity(player: PlayerSnapshot, dt: number, now: number): Vec3 {
    const vehicle = this.state.vehicles.find((item) => item.id === player.vehicleId)!;
    const config = VEHICLE_CONFIG[vehicle.kind];
    const motion = this.vehicleMotion.get(vehicle.id) ?? { speed: 0, x: Math.sin(vehicle.yaw), z: Math.cos(vehicle.yaw) };
    const input = this.inputs.get(player.id);
    const length = input && now - input.receivedAt < 300 ? Math.hypot(input.x, input.z) : 0;
    const target = config.maxSpeed * Math.min(length, 1);
    const acceleration = target > motion.speed ? config.acceleration : config.braking;
    motion.speed += Math.sign(target - motion.speed) * Math.min(Math.abs(target - motion.speed), acceleration * dt);
    if (length && input) { motion.x = input.x / length; motion.z = input.z / length; vehicle.yaw = Math.atan2(motion.x, motion.z); }
    this.vehicleMotion.set(vehicle.id, motion);
    return [motion.x * motion.speed, 0, motion.z * motion.speed];
  }
  private syncVehicle(player: PlayerSnapshot, before: Vec3, dt: number) {
    const vehicle = this.state.vehicles.find((item) => item.id === player.vehicleId)!;
    vehicle.position = [...player.position];
    vehicle.speed = dt > 0 ? Math.round(Math.min(VEHICLE_CONFIG[vehicle.kind].maxSpeed, Math.hypot(player.position[0] - before[0], player.position[2] - before[2]) / dt) * 10000) / 10000 : 0;
    player.yaw = vehicle.yaw; player.animation = "idle";
    if (dt >= PHYSICS_TIMESTEP && vehicle.speed < 0.01) {
      const motion = this.vehicleMotion.get(vehicle.id); if (motion) motion.speed = 0;
    }
  }
  tick(deltaSeconds: number, now = performance.now()) {
    if (this.disposed) return;
    const dt = Math.min(Math.max(deltaSeconds, 0), 0.1);
    if (!Number.isFinite(dt)) return;
    for (const player of this.state.players) {
      if (!player.emote || dt === 0) continue;
      player.emote.elapsed += dt;
      if (player.emote.elapsed >= EMOTES[player.emote.name].duration) player.emote = null;
      this.changed();
    }
    if (this.physics) {
      const velocities = new Map<string, Vec3>();
      for (const player of this.state.players) {
        if (player.vehicleId) { velocities.set(player.id, this.driveVelocity(player, dt, now)); continue; }
        const input = this.inputs.get(player.id);
        if (!input || now - input.receivedAt >= 300 || this.state.encounters.some((encounter) => encounter.participantIds.includes(player.id))) continue;
        const length = Math.max(1, Math.hypot(input.x, input.z));
        const speed = input.sprint ? SPRINT_SPEED : WALK_SPEED;
        velocities.set(player.id, [input.x * speed / length, 0, input.z * speed / length]);
      }
      this.physics.tick(dt, velocities);
      let changed = false;
      for (const player of this.state.players) {
        const position = this.physics.position(player.id).map((value) => Math.round(value * 100000) / 100000) as Vec3;
        if (player.vehicleId) {
          const before = player.position; player.position = position;
          this.syncVehicle(player, before, dt); changed = true; continue;
        }
        const animation = Math.hypot(position[0] - player.position[0], position[2] - player.position[2]) > 0.0001 ? this.inputs.get(player.id)?.sprint ? "run" : "walk" : "idle";
        const yaw = this.inputs.get(player.id)?.yaw ?? player.yaw;
        if (position.some((value, i) => value !== player.position[i]) || animation !== player.animation || yaw !== player.yaw) changed = true;
        player.position = position; player.animation = animation; player.yaw = yaw;
      }
      if (changed) this.changed();
      return;
    }
    let changed = false;
    for (const player of this.state.players) {
      if (player.vehicleId) {
        const before = [...player.position] as Vec3;
        const velocity = this.driveVelocity(player, dt, now);
        const profile = this.vehicleProfile(this.state.vehicles.find((item) => item.id === player.vehicleId)!);
        const steps = Math.max(1, Math.ceil(dt / PHYSICS_TIMESTEP));
        for (let i = 0; i < steps; i++) {
          for (const axis of [0, 2] as const) {
            const next: Vec3 = [...player.position]; next[axis] += velocity[axis] * dt / steps;
            if (this.canStand(next, profile)) player.position = next;
          }
        }
        this.syncVehicle(player, before, dt); changed = true; continue;
      }
      const input = this.inputs.get(player.id);
      const canMove = input && now - input.receivedAt < 300 && !this.state.encounters.some((e) => e.participantIds.includes(player.id));
      const length = canMove ? Math.hypot(input.x, input.z) : 0;
      const old = [...player.position];
      if (canMove && length > 0) {
        const step = (input.sprint ? SPRINT_SPEED : WALK_SPEED) * dt / Math.max(1, length);
        for (const [axis, amount] of [[0, input.x * step], [2, input.z * step]] as const) {
          const next: Vec3 = [...player.position]; next[axis] += amount;
          if (this.canStand(next)) player.position = next;
        }
      }
      const animation = old.some((v, i) => v !== player.position[i]) ? input?.sprint ? "run" : "walk" : "idle";
      const yaw = input?.yaw ?? player.yaw;
      if (animation !== player.animation || yaw !== player.yaw || animation !== "idle") changed = true;
      player.animation = animation; player.yaw = yaw;
    }
    if (changed) this.changed();
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.inputs.clear();
    this.vehicleMotion.clear();
    this.physics?.dispose();
  }
}
