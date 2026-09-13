import { RoomPhysics, PHYSICS_TIMESTEP, WALKING_PROFILE, type ActorProfile } from "./physics";
import { WALK_SPEED, SPRINT_SPEED } from "./player-actions";
import { VEHICLE_CONFIG } from "./vehicle-contract";
import type { EnvironmentManifest, PlayerSnapshot, Vec3, VehicleSnapshot } from "./schema";

export const MAX_PREDICTION_MS = 750;
const HISTORY_MS = 2_000;
const MAX_HISTORY = 512;
const STEP_MS = PHYSICS_TIMESTEP * 1000;
interface Input { sequence?: number; at: number; direction: [number, number]; yaw: number; sprint: boolean }
export interface PredictedMovement { position: Vec3; yaw: number; animation: PlayerSnapshot["animation"]; vehicleSpeed: number }
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));

/** Render our own movement without a network round trip. The authority still owns
 * positions: restore its acknowledged pose, then replay only recent local inputs.
 * The same 60Hz Rapier capsule/slope/collision controller runs on both ends.
 */
export class LocalMovementPredictor {
  private physics?: RoomPhysics;
  private authority?: PlayerSnapshot;
  private vehicle?: VehicleSnapshot;
  private profile: ActorProfile = WALKING_PROFILE;
  private inputs: Input[] = [];
  private position: Vec3 = [0, 0, 0];
  private yaw = 0;
  private animation: PlayerSnapshot["animation"] = "idle";
  private speed = 0;
  private travel: [number, number] = [0, 1];
  private simulatedAt = 0;
  private receivedAt = 0;
  private renderOffset: Vec3 = [0, 0, 0];
  private blocked = false;
  private lastSequence = -1;

  constructor(private environment: EnvironmentManifest) {
    if (environment.physics) this.physics = new RoomPhysics(environment);
  }

  recordLocalInput(direction: [number, number], yaw: number, sprint: boolean, now: number) {
    if (!Number.isFinite(now) || !direction.every(Number.isFinite) || !Number.isFinite(yaw)) return;
    const previous = this.inputs[this.inputs.length - 1];
    if (previous && previous.yaw === yaw && previous.sprint === sprint && previous.direction[0] === direction[0] && previous.direction[1] === direction[1]) return;
    this.appendInput({ at: now, direction, yaw, sprint });
  }

  recordInput(sequence: number, direction: [number, number], yaw: number, sprint: boolean, now: number) {
    if (!Number.isSafeInteger(sequence) || sequence <= this.lastSequence || !Number.isFinite(now) || !direction.every(Number.isFinite) || !Number.isFinite(yaw)) return;
    this.lastSequence = sequence;
    const previous = this.inputs[this.inputs.length - 1];
    if (previous?.at === now && previous.sequence === undefined) Object.assign(previous, { sequence, direction: [...direction], yaw, sprint });
    else this.appendInput({ sequence, at: now, direction, yaw, sprint });
  }

  private appendInput(input: Input) {
    const length = Math.max(1, Math.hypot(...input.direction));
    this.inputs.push({ ...input, direction: [input.direction[0] / length, input.direction[1] / length] });
    this.inputs = this.inputs.filter((sample) => sample.at >= input.at - HISTORY_MS).slice(-MAX_HISTORY);
  }

  setBlocked(blocked: boolean, now = this.simulatedAt) {
    if (this.blocked && !blocked && this.authority) {
      // No movement can occur while a modal/encounter blocks us. Resume from that
      // stationary trusted pose with a fresh, bounded local prediction window.
      if (now - this.receivedAt > MAX_PREDICTION_MS) {
        this.position = [...this.authority.position];
        this.physics?.restore(this.authority.id, this.position, this.authority.movementAck?.verticalVelocity ?? 0);
        this.renderOffset = [0, 0, 0]; this.speed = 0;
      }
      this.receivedAt = now; this.simulatedAt = now;
    }
    this.blocked = blocked;
  }

  reconcile(player: PlayerSnapshot, vehicle: VehicleSnapshot | undefined, now: number) {
    if (player === this.authority) return;
    const previous = this.authority;
    const changedActor = !previous || previous.id !== player.id || previous.vehicleId !== player.vehicleId;
    const teleported = !!previous && distance(previous.position, player.position) > 2.5;
    const displayed = this.position.map((value, axis) => value + this.renderOffset[axis]) as Vec3;
    this.authority = player;
    this.vehicle = vehicle;
    this.receivedAt = now;
    if (changedActor) {
      if (previous) this.physics?.leave(previous.id);
      this.profile = vehicle ? { ...VEHICLE_CONFIG[vehicle.kind], vehicle: true } : this.physics ? WALKING_PROFILE : { radius: 0.3, height: 1.7 };
      this.physics?.join(player.id, player.position, this.profile);
    }
    this.position = [...player.position];
    this.physics?.restore(player.id, this.position, player.movementAck?.verticalVelocity ?? 0);
    this.yaw = player.yaw;
    this.animation = player.animation;
    this.speed = vehicle?.speed ?? 0;
    this.travel = [Math.sin(player.yaw), Math.cos(player.yaw)];
    this.simulatedAt = now;
    if (changedActor || teleported) {
      this.inputs = [];
      if (!previous || previous.id !== player.id) this.lastSequence = -1;
      this.renderOffset = [0, 0, 0];
      return;
    }
    const ack = player.movementAck;
    const acknowledged = ack && this.inputs.find((input) => input.sequence === ack.sequence);
    // The timestamp belongs to our own monotonic clock. Server processing duration
    // advances it without assuming the two machines' wall clocks agree.
    let replayFrom: number | undefined = acknowledged && ack ? acknowledged.at + ack.elapsedSeconds * 1000 : this.inputs[0]?.at;
    if (ack && !acknowledged) replayFrom = undefined;
    if (replayFrom !== undefined) {
      this.simulatedAt = Math.max(now - MAX_PREDICTION_MS, Math.min(now, replayFrom));
      this.simulateUntil(now);
    }
    if (acknowledged) this.inputs = this.inputs.slice(this.inputs.indexOf(acknowledged));
    const correction = displayed.map((value, axis) => value - this.position[axis]) as Vec3;
    this.renderOffset = distance(displayed, this.position) <= 1 ? correction : [0, 0, 0];
  }

  advance(now: number, deltaSeconds: number): PredictedMovement | null {
    if (!this.authority) return null;
    const end = Math.min(now, this.receivedAt + MAX_PREDICTION_MS);
    if (now - this.simulatedAt > MAX_PREDICTION_MS) this.simulatedAt = end;
    this.simulateUntil(end);
    if (now > this.receivedAt + MAX_PREDICTION_MS) this.animation = "idle";
    const decay = Math.exp(-18 * Math.min(0.1, Math.max(0, deltaSeconds)));
    this.renderOffset = this.renderOffset.map((value) => value * decay) as Vec3;
    let display = this.position.map((value, axis) => value + this.renderOffset[axis]) as Vec3;
    // Cosmetic reconciliation may never ease a capsule through a wall.
    if (Math.hypot(...this.renderOffset) > 0.0001 && !this.canStand(display)) { this.renderOffset = [0, 0, 0]; display = [...this.position]; }
    return { position: display, yaw: this.yaw, animation: this.animation, vehicleSpeed: this.speed };
  }

  private simulateUntil(end: number) {
    while (this.simulatedAt + STEP_MS <= end + 1e-6) {
      const at = this.simulatedAt;
      let input: Input | undefined;
      for (let i = this.inputs.length - 1; i >= 0; i--) if (this.inputs[i].at <= at + 1e-6) { input = this.inputs[i]; break; }
      if (input && at - input.at >= 300) input = undefined;
      const direction = !this.blocked && input ? input.direction : [0, 0];
      const length = Math.hypot(...direction);
      let velocity: Vec3;
      if (this.vehicle) {
        const config = VEHICLE_CONFIG[this.vehicle.kind];
        const target = config.maxSpeed * Math.min(1, length);
        const acceleration = target > this.speed ? config.acceleration : config.braking;
        this.speed += Math.sign(target - this.speed) * Math.min(Math.abs(target - this.speed), acceleration * PHYSICS_TIMESTEP);
        if (length) { this.travel = [direction[0] / length, direction[1] / length]; this.yaw = Math.atan2(...this.travel); }
        velocity = [this.travel[0] * this.speed, 0, this.travel[1] * this.speed];
      } else {
        const speed = input?.sprint ? SPRINT_SPEED : WALK_SPEED;
        velocity = [direction[0] * speed, 0, direction[1] * speed];
        if (input && !this.blocked) this.yaw = input.yaw;
      }
      const before = this.position;
      if (this.physics) {
        this.physics.tick(PHYSICS_TIMESTEP, new Map([[this.authority!.id, velocity]]));
        this.position = this.physics.position(this.authority!.id);
      } else {
        for (const axis of [0, 2] as const) {
          const next: Vec3 = [...this.position]; next[axis] += velocity[axis] * PHYSICS_TIMESTEP;
          if (this.canStand(next)) this.position = next;
        }
      }
      const moved = Math.hypot(this.position[0] - before[0], this.position[2] - before[2]);
      this.animation = this.vehicle || moved < 0.0001 ? "idle" : input?.sprint ? "run" : "walk";
      if (this.vehicle && moved < 0.0001) this.speed = 0;
      this.simulatedAt += STEP_MS;
    }
  }

  private canStand(position: Vec3) {
    if (this.physics) return this.physics.canStand(position, this.profile);
    const { bounds, colliders } = this.environment;
    const { radius, height } = this.profile;
    return position.every(Number.isFinite) && position[0] >= bounds.min[0] + radius && position[0] <= bounds.max[0] - radius
      && position[2] >= bounds.min[2] + radius && position[2] <= bounds.max[2] - radius
      && !colliders.some(({ min, max }) => position[1] < max[1] && position[1] + height > min[1] && position[0] > min[0] - radius
        && position[0] < max[0] + radius && position[2] > min[2] - radius && position[2] < max[2] + radius);
  }

  get pendingInputCount() { return this.inputs.length; }
  dispose() { this.physics?.dispose(); this.inputs = []; this.authority = undefined; }
}
