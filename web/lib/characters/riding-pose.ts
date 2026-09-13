import * as THREE from "three";
import type { VehicleKind } from "../world/schema";

export type RidingState = { kind: VehicleKind; speed: number; lean?: number };
type Transform = { node: THREE.Object3D; position: THREE.Vector3; quaternion: THREE.Quaternion };
const UP = new THREE.Vector3(0, 1, 0);

/** A reversible layer over the authored animation mixer, in metres above vehicle ground. */
export class AvatarRidingPose {
  private state: RidingState | null = null;
  private applied = false;
  private time = 0;
  private readonly bones = new Map<string, THREE.Object3D>();
  private readonly rest: Transform[] = [];
  private readonly animated: Transform[] = [];
  private readonly modelPosition: THREE.Vector3;
  private readonly modelQuaternion: THREE.Quaternion;

  constructor(private readonly model: THREE.Object3D) {
    this.modelPosition = model.position.clone();
    this.modelQuaternion = model.quaternion.clone();
    model.traverse((node) => {
      if (!(node instanceof THREE.Bone)) return;
      this.bones.set(node.name, node);
      this.rest.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone() });
      this.animated.push({ node, position: node.position.clone(), quaternion: node.quaternion.clone() });
    });
  }

  get kind(): VehicleKind | null { return this.state?.kind ?? null; }

  set(state: RidingState | null): void {
    if (!state) this.restore();
    this.state = state ? {
      kind: state.kind,
      speed: Number.isFinite(state.speed) ? THREE.MathUtils.clamp(state.speed, -15, 15) : 0,
      lean: Number.isFinite(state.lean) ? THREE.MathUtils.clamp(state.lean!, -.18, .18) : 0,
    } : null;
  }

  /** Remove last frame's layer before AnimationMixer reads/writes its tracked bones. */
  restore(): void {
    if (!this.applied) return;
    for (const { node, position, quaternion } of this.animated) {
      node.position.copy(position); node.quaternion.copy(quaternion);
    }
    this.model.position.copy(this.modelPosition);
    this.model.quaternion.copy(this.modelQuaternion);
    this.applied = false;
  }

  private rotate(name: string, x = 0, y = 0, z = 0): void {
    const bone = this.bones.get(name);
    if (bone) bone.quaternion.setFromEuler(new THREE.Euler(x, y, z));
  }

  private worldTarget(position: THREE.Vector3): THREE.Vector3 {
    // Targets live in vehicle axes, independently of avatar appearance height/yaw.
    const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.state?.lean ?? 0);
    const target = position.clone().applyQuaternion(bank);
    return this.model.parent ? this.model.parent.localToWorld(target) : target;
  }

  private vehicleOrientation(local = new THREE.Quaternion()): THREE.Quaternion {
    const parent = this.model.parent?.getWorldQuaternion(new THREE.Quaternion()) ?? new THREE.Quaternion();
    const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), this.state?.lean ?? 0);
    return parent.multiply(bank).multiply(local);
  }

  private aimBone(bone: THREE.Object3D, child: THREE.Object3D, target: THREE.Vector3): void {
    const origin = bone.getWorldPosition(new THREE.Vector3());
    const before = child.getWorldPosition(new THREE.Vector3()).sub(origin).normalize();
    const after = target.clone().sub(origin).normalize();
    if (before.lengthSq() < .5 || after.lengthSq() < .5) return;
    const delta = new THREE.Quaternion().setFromUnitVectors(before, after);
    const world = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ?? new THREE.Quaternion();
    bone.quaternion.copy(parent.multiply(world));
    this.model.updateMatrixWorld(true);
  }

  private orientBone(bone: THREE.Object3D, world: THREE.Quaternion): void {
    const parent = bone.parent?.getWorldQuaternion(new THREE.Quaternion()).invert() ?? new THREE.Quaternion();
    bone.quaternion.copy(parent.multiply(world));
    this.model.updateMatrixWorld(true);
  }

  /** Solve an actual rig chain; limb lengths automatically follow appearance scaling. */
  private limb(upperName: string, lowerName: string, endName: string,
    targetLocal: THREE.Vector3, bendLocal: THREE.Vector3, endOrientation: THREE.Quaternion): void {
    const upper = this.bones.get(upperName), lower = this.bones.get(lowerName), end = this.bones.get(endName);
    if (!upper || !lower || !end) return;
    const a = upper.getWorldPosition(new THREE.Vector3());
    const b = lower.getWorldPosition(new THREE.Vector3());
    const c = end.getWorldPosition(new THREE.Vector3());
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    if (l1 < .001 || l2 < .001) return;
    const target = this.worldTarget(targetLocal);
    const toward = target.clone().sub(a);
    const distance = THREE.MathUtils.clamp(toward.length(), Math.abs(l1 - l2) + .0001, l1 + l2 - .0001);
    toward.normalize();
    const bend = bendLocal.clone().applyQuaternion(this.vehicleOrientation());
    bend.addScaledVector(toward, -bend.dot(toward));
    if (bend.lengthSq() < .0001) bend.copy(UP).cross(toward);
    bend.normalize();
    const along = (l1 * l1 + distance * distance - l2 * l2) / (2 * distance);
    const height = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    const knee = a.clone().addScaledVector(toward, along).addScaledVector(bend, height);
    this.aimBone(upper, lower, knee);
    this.aimBone(lower, end, a.clone().addScaledVector(toward, distance));
    this.orientBone(end, this.vehicleOrientation(endOrientation));
  }

  /** Call after mixer.update. No authoritative actor transform is ever modified. */
  apply(dt: number): void {
    if (!this.state) return;
    if (this.applied) this.restore();
    this.time += Math.max(0, Math.min(Number.isFinite(dt) ? dt : 0, .1));
    for (const saved of this.animated) {
      saved.position.copy(saved.node.position); saved.quaternion.copy(saved.node.quaternion);
    }
    for (const saved of this.rest) {
      saved.node.position.copy(saved.position); saved.node.quaternion.copy(saved.quaternion);
    }
    this.model.position.copy(this.modelPosition);
    this.model.quaternion.copy(this.modelQuaternion);
    this.applied = true;
    const hips = this.bones.get("hips");
    if (!hips) return;
    const scale = Math.max(.1, this.model.scale.y);
    const speed = Math.abs(this.state.speed);
    const lean = this.state.lean ?? 0;
    const bank = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), lean);
    const flatFoot = new THREE.Quaternion();
    if (this.state.kind === "scooter") {
      this.model.quaternion.copy(this.modelQuaternion).premultiply(bank);
      hips.position.set(0, .875 / scale, (-.16 + (1 - scale) * .25) / scale);
      this.rotate("spine", .49); this.rotate("chest", .10); this.rotate("head", -.39);
      this.model.updateMatrixWorld(true);
      const handOrientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
      const handSocketOffset = new THREE.Vector3(0, -.05, .05).multiplyScalar(scale).applyQuaternion(handOrientation);
      for (const side of ["L", "R"] as const) {
        const sign = side === "L" ? 1 : -1;
        this.limb(`${side}_thigh`, `${side}_shin`, `${side}_foot`,
          new THREE.Vector3(sign * .16, .30 + .10 * scale, .08), new THREE.Vector3(0, 0, 1), flatFoot);
        this.limb(`${side}_upperArm`, `${side}_forearm`, `${side}_hand`,
          new THREE.Vector3(sign * .28, 1.12, .50).sub(handSocketOffset), new THREE.Vector3(sign * .35, -1, 0), handOrientation);
      }
    } else {
      this.model.quaternion.copy(this.modelQuaternion)
        .multiply(new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2)).premultiply(bank);
      const balance = Math.sin(this.time * 4.2) * Math.min(speed / 6, 1) * .012;
      hips.position.y = .75 + (.15 - .12 + balance) / scale;
      this.rotate("spine", .09, 0, -.035);
      this.rotate("chest", -.04);
      this.rotate("head", -.03, -Math.PI / 2, 0);
      this.rotate("L_upperArm", -.18, 0, .40 + balance * 2);
      this.rotate("R_upperArm", -.25, 0, -.40 - balance * 2);
      this.rotate("L_forearm", -.20); this.rotate("R_forearm", -.28);
      this.model.updateMatrixWorld(true);
      const sidewaysFoot = new THREE.Quaternion().setFromAxisAngle(UP, Math.PI / 2);
      for (const side of ["L", "R"] as const) {
        this.limb(`${side}_thigh`, `${side}_shin`, `${side}_foot`,
          new THREE.Vector3(0, .15 + .10 * scale, side === "L" ? -.23 : .23),
          new THREE.Vector3(1, 0, 0), sidewaysFoot);
      }
    }
    this.model.updateMatrixWorld(true);
  }
}
