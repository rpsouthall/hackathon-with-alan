import type { Collider, KinematicCharacterController, RigidBody, World } from "@dimforge/rapier3d-compat";
import type { EnvironmentManifest, Vec3 } from "./schema";

let rapier: typeof import("@dimforge/rapier3d-compat").default | undefined;
let initialization: Promise<void> | undefined;

/** Initialize WASM explicitly before constructing a room with physics metadata. */
export function initWorldPhysics(): Promise<void> {
  return initialization ??= import("@dimforge/rapier3d-compat").then(async (module) => {
    await module.default.init();
    rapier = module.default;
  }).catch((error) => { initialization = undefined; throw error; });
}

export const PHYSICS_PLAYER_RADIUS = 0.28;
export const PHYSICS_PLAYER_HEIGHT = 1.7;
export const PHYSICS_TIMESTEP = 1 / 60;
const vector = ([x, y, z]: Vec3) => ({ x, y, z });

interface Actor {
  body: RigidBody;
  collider: Collider;
  controller: KinematicCharacterController;
  verticalVelocity: number;
}

/** One Rapier world per authoritative room. Player origins are at their feet.
 * Cosmetic height does not affect collisions, and learners do not push one another.
 */
export class RoomPhysics {
  private world: World;
  private actors = new Map<string, Actor>();
  private staticHandles = new Set<number>();
  private disposed = false;
  private accumulator = 0;

  constructor(private environment: EnvironmentManifest) {
    if (!rapier) throw new Error("Call and await initWorldPhysics() before creating a physics room");
    const config = environment.physics;
    if (!config) throw new Error("Physics metadata is required");
    this.world = new rapier.World({ x: 0, y: config.gravity, z: 0 });
    this.world.timestep = PHYSICS_TIMESTEP;
    for (const box of config.colliders) {
      const [x, y, z, w] = box.quaternion;
      this.staticHandles.add(this.world.createCollider(rapier.ColliderDesc.cuboid(...box.halfExtents)
        .setTranslation(...box.position).setRotation({ x, y, z, w })).handle);
    }
    // Existing AABBs may supplement the exported boxes.
    for (const box of environment.colliders) this.addBox(box.min, box.max);
    const { min, max } = environment.bounds;
    // Solid perimeter walls preserve horizontal room limits even on sloping ground.
    this.addBox([min[0] - 1, min[1] - 20, min[2] - 1], [min[0], max[1] + 20, max[2] + 1]);
    this.addBox([max[0], min[1] - 20, min[2] - 1], [max[0] + 1, max[1] + 20, max[2] + 1]);
    this.addBox([min[0], min[1] - 20, min[2] - 1], [max[0], max[1] + 20, min[2]]);
    this.addBox([min[0], min[1] - 20, max[2]], [max[0], max[1] + 20, max[2] + 1]);
    this.world.step();
    // Catch an invalid spawn before opening the room to any players.
    const probe = this.world.createCollider(rapier.ColliderDesc.capsule((PHYSICS_PLAYER_HEIGHT - 2 * PHYSICS_PLAYER_RADIUS) / 2, PHYSICS_PLAYER_RADIUS)
      .setTranslation(environment.spawn[0], environment.spawn[1] + PHYSICS_PLAYER_HEIGHT / 2, environment.spawn[2]));
    let invalid = false;
    for (const handle of this.staticHandles) {
      const contact = probe.contactCollider(this.world.getCollider(handle), 0);
      if (contact && contact.distance < -0.02) { invalid = true; break; }
    }
    this.world.removeCollider(probe, false);
    if (invalid) { this.dispose(); throw new Error("Player spawn overlaps a physics collider or boundary"); }
  }

  private addBox(min: Vec3, max: Vec3) {
    const center = min.map((value, i) => (value + max[i]) / 2) as Vec3;
    const half = min.map((value, i) => (max[i] - value) / 2) as Vec3;
    this.staticHandles.add(this.world.createCollider(rapier!.ColliderDesc.cuboid(...half).setTranslation(...center)).handle);
  }

  join(id: string, feet: Vec3) {
    if (this.disposed) throw new Error("Physics room is closed");
    const body = this.world.createRigidBody(rapier!.RigidBodyDesc.kinematicPositionBased().setTranslation(feet[0], feet[1] + PHYSICS_PLAYER_HEIGHT / 2, feet[2]));
    const collider = this.world.createCollider(rapier!.ColliderDesc.capsule((PHYSICS_PLAYER_HEIGHT - 2 * PHYSICS_PLAYER_RADIUS) / 2, PHYSICS_PLAYER_RADIUS), body);
    const controller = this.world.createCharacterController(0.01);
    const config = this.environment.physics!;
    controller.setUp({ x: 0, y: 1, z: 0 });
    controller.setMaxSlopeClimbAngle(config.maxSlopeDegrees * Math.PI / 180);
    controller.setMinSlopeSlideAngle(config.maxSlopeDegrees * Math.PI / 180);
    if (config.groundSnap > 0) controller.enableSnapToGround(config.groundSnap);
    if (config.stepHeight > 0) controller.enableAutostep(config.stepHeight, 0.20, false);
    controller.setSlideEnabled(true);
    this.actors.set(id, { body, collider, controller, verticalVelocity: 0 });
  }

  leave(id: string) {
    const actor = this.actors.get(id);
    if (!actor || this.disposed) return;
    this.world.removeCharacterController(actor.controller);
    this.world.removeRigidBody(actor.body);
    this.actors.delete(id);
  }

  position(id: string): Vec3 {
    const p = this.actors.get(id)!.body.translation();
    return [p.x, p.y - PHYSICS_PLAYER_HEIGHT / 2, p.z];
  }

  /** Velocities are server-derived, never positions or speeds supplied by clients. */
  tick(delta: number, velocities: Map<string, Vec3>) {
    if (this.disposed || !Number.isFinite(delta)) return;
    this.accumulator += Math.min(Math.max(delta, 0), 0.1);
    while (this.accumulator + 1e-9 >= PHYSICS_TIMESTEP) {
      this.accumulator = Math.max(0, this.accumulator - PHYSICS_TIMESTEP);
      for (const [id, actor] of this.actors) {
        const horizontal = velocities.get(id) ?? [0, 0, 0];
        actor.verticalVelocity = Math.max(-8, actor.verticalVelocity + this.environment.physics!.gravity * PHYSICS_TIMESTEP);
        actor.controller.computeColliderMovement(actor.collider, {
          x: horizontal[0] * PHYSICS_TIMESTEP, y: actor.verticalVelocity * PHYSICS_TIMESTEP, z: horizontal[2] * PHYSICS_TIMESTEP,
        }, undefined, undefined, (collider) => this.staticHandles.has(collider.handle));
        const p = actor.body.translation(), move = actor.controller.computedMovement();
        actor.body.setNextKinematicTranslation({ x: p.x + move.x, y: p.y + move.y, z: p.z + move.z });
        if (actor.controller.computedGrounded()) actor.verticalVelocity = 0;
      }
      this.world.step();
      for (const actor of this.actors.values()) {
        const p = actor.body.translation(), { min, max } = this.environment.bounds;
        if (![p.x, p.y, p.z].every(Number.isFinite) || p.y - PHYSICS_PLAYER_HEIGHT / 2 < min[1] || p.y - PHYSICS_PLAYER_HEIGHT / 2 > max[1]
          || p.x < min[0] || p.x > max[0] || p.z < min[2] || p.z > max[2]) {
          const spawn = vector(this.environment.spawn);
          spawn.y += PHYSICS_PLAYER_HEIGHT / 2;
          actor.body.setTranslation(spawn, true);
          actor.body.setNextKinematicTranslation(spawn);
          actor.verticalVelocity = 0;
        }
      }
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.actors.clear();
    this.staticHandles.clear();
    this.world.free();
  }
}
