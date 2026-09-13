import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export type CameraView = "isometric" | "third-person";
type Shot = CameraView | "overview" | "encounter";
type Pose = { radius: number; phi: number; theta: number; halfHeight: number; perspective: number };
const ISO_POLAR = Math.acos(1 / Math.sqrt(3));
const THIRD_RADIUS = 6.5;
const THIRD_FOV = 50;
const TRANSITION_SECONDS = 0.75;
const thirdHeight = (radius: number) => radius * Math.tan(THIRD_FOV * Math.PI / 360);
const defaultPoses = (): Record<Shot, Pose> => ({
  isometric: { radius: Math.sqrt(3) * 18, phi: ISO_POLAR, theta: Math.PI / 4, halfHeight: 12, perspective: 0 },
  "third-person": { radius: THIRD_RADIUS, phi: 1.16, theta: Math.PI, halfHeight: thirdHeight(THIRD_RADIUS), perspective: 1 },
  encounter: { radius: 4.5, phi: 1.38, theta: 0, halfHeight: thirdHeight(4.5), perspective: 1 },
  overview: { radius: Math.sqrt(3) * 50, phi: ISO_POLAR, theta: Math.PI / 4, halfHeight: 39, perspective: 0 },
});

/** Orthographic and perspective matrices normalized at the focus plane.
 * Interpolating this form keeps the subject centered and avoids a projection jump.
 */
export function setTransitionProjection(camera: THREE.PerspectiveCamera, pose: Pose, aspect: number): void {
  const p = pose.perspective, d = pose.radius, h = pose.halfHeight;
  const n = camera.near, f = camera.far, range = f - n;
  camera.projectionMatrix.set(
    1 / (h * aspect), 0, 0, 0,
    0, 1 / h, 0, 0,
    0, 0, -(2 * (1 - p) + p * (f + n) / d) / range, -((1 - p) * (f + n) + 2 * p * f * n / d) / range,
    0, 0, -p / d, 1 - p,
  );
  camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
}

/** Owns only presentation. It never changes a player's position or network state. */
export class GameCameraRig {
  readonly orthographic = new THREE.OrthographicCamera(-12, 12, 12, -12, 0.1, 250);
  readonly perspective = new THREE.PerspectiveCamera(THIRD_FOV, 1, 0.1, 250);
  readonly focus = new THREE.Vector3();
  readonly isoControls: OrbitControls;
  readonly thirdControls: OrbitControls;
  view: CameraView = "isometric";
  overview = false;

  private readonly blendCamera = new THREE.PerspectiveCamera(THIRD_FOV, 1, 0.1, 250);
  private readonly poses = defaultPoses();
  private readonly center: THREE.Vector3;
  private readonly desiredFocus = new THREE.Vector3();
  private readonly delta = new THREE.Vector3();
  private readonly spherical = new THREE.Spherical();
  private encounter?: { position: THREE.Vector3; yaw: number };
  private viewportWidth = 1280;
  private aspect = 1;
  private thirdVisited = false;
  private enabled = true;
  private disposed = false;
  private transition?: { from: Pose; to: Pose; focus: THREE.Vector3; elapsed: number };
  private blendPose: Pose = { ...this.poses.isometric };

  constructor(spawn: THREE.Vector3, center: THREE.Vector3, element?: HTMLElement, private reducedMotion = false) {
    this.focus.copy(spawn).add(new THREE.Vector3(0, 1, 0));
    this.center = center.clone();
    this.isoControls = new OrbitControls(this.orthographic, element);
    this.thirdControls = new OrbitControls(this.perspective, element);
    for (const controls of [this.isoControls, this.thirdControls]) {
      controls.enablePan = false;
      controls.minAzimuthAngle = -Infinity;
      controls.maxAzimuthAngle = Infinity;
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      controls.touches.ONE = THREE.TOUCH.ROTATE;
      controls.touches.TWO = THREE.TOUCH.DOLLY_ROTATE;
      controls.target.copy(this.focus);
    }
    this.isoControls.minPolarAngle = ISO_POLAR;
    this.isoControls.maxPolarAngle = ISO_POLAR;
    this.isoControls.minZoom = 0.6;
    this.isoControls.maxZoom = 2.5;
    this.isoControls.mouseButtons.LEFT = null;
    this.thirdControls.minPolarAngle = 0.12;
    this.thirdControls.maxPolarAngle = Math.PI / 2 - 0.07;
    this.thirdControls.minDistance = 2;
    this.thirdControls.maxDistance = 12;
    this.thirdControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
    this.installPose(this.poses.isometric);
  }

  get isTransitioning(): boolean { return !!this.transition; }
  get shot(): Shot { return this.encounter ? "encounter" : this.overview ? "overview" : this.view; }
  get camera(): THREE.OrthographicCamera | THREE.PerspectiveCamera {
    return this.transition ? this.blendCamera : (this.shot === "third-person" || this.shot === "encounter") ? this.perspective : this.orthographic;
  }
  private get controls(): OrbitControls { return (this.shot === "third-person" || this.shot === "encounter") ? this.thirdControls : this.isoControls; }

  private readPose(): Pose {
    if (this.transition) return { ...this.blendPose };
    this.spherical.setFromVector3(this.delta.subVectors(this.camera.position, this.focus));
    const radius = this.spherical.radius;
    return { radius, theta: this.spherical.theta, phi: this.spherical.phi,
      halfHeight: (this.shot === "third-person" || this.shot === "encounter") ? thirdHeight(radius) : (this.overview ? 39 : 12) / this.orthographic.zoom,
      perspective: (this.shot === "third-person" || this.shot === "encounter") ? 1 : 0 };
  }

  private installPose(pose: Pose): void {
    const camera = (this.shot === "third-person" || this.shot === "encounter") ? this.perspective : this.orthographic;
    // Consume old drag inertia before assigning the exact destination pose.
    this.controls.enableDamping = false;
    this.controls.update();
    camera.position.setFromSpherical(this.spherical.set(pose.radius, pose.phi, pose.theta)).add(this.focus);
    camera.lookAt(this.focus);
    if ((this.shot !== "third-person" && this.shot !== "encounter")) this.orthographic.zoom = (this.overview ? 39 : 12) / pose.halfHeight;
    this.controls.target.copy(this.focus);
    this.controls.update();
    this.controls.enableDamping = true;
    this.resize(this.aspect, 1);
    this.syncInput();
  }

  private syncInput(): void {
    this.isoControls.enabled = this.enabled && !this.encounter && !this.transition && (this.shot !== "third-person" && this.shot !== "encounter");
    this.thirdControls.enabled = this.enabled && !this.encounter && !this.transition && (this.shot === "third-person" || this.shot === "encounter");
  }
  setInputEnabled(enabled: boolean): void { this.enabled = enabled; this.syncInput(); }

  private select(view: CameraView, overview: boolean, yaw = 0): void {
    if (this.view === view && this.overview === overview) return;
    const from = this.readPose();
    if (!this.transition) this.poses[this.shot] = { ...from };
    this.view = view;
    this.overview = overview;
    if ((this.shot === "third-person" || this.shot === "encounter") && !this.thirdVisited) {
      this.poses["third-person"].theta = yaw + Math.PI;
      this.thirdVisited = true;
    }
    this.blendPose = { ...from };
    this.transition = { from, to: { ...this.poses[this.shot] }, focus: this.focus.clone(), elapsed: 0 };
    this.syncInput();
    // Construct the exact starting frame even before the next animation callback.
    this.applyBlend(from);
  }
  setView(view: CameraView, yaw = 0): void { this.select(view, false, yaw); }
  setOverview(overview: boolean): void { this.select(this.view, overview); }

  setEncounter(position: THREE.Vector3 | null, yaw = 0): void {
    if (position && this.encounter) { this.encounter.position.copy(position); return; }
    if (!position && !this.encounter) return;
    const from = this.readPose();
    if (!this.encounter && !this.transition) this.poses[this.shot] = { ...from };
    this.encounter = position ? { position: position.clone(), yaw } : undefined;
    if (position) this.poses.encounter.theta = yaw;
    this.blendPose = { ...from };
    this.transition = { from, to: { ...this.poses[this.shot] }, focus: this.focus.clone(), elapsed: 0 };
    this.syncInput();
    this.applyBlend(from);
  }

  resize(width: number, height: number): void {
    if (height > 1) this.viewportWidth = width;
    this.aspect = Math.max(width, 1e-5) / Math.max(height, 1e-5);
    const h = this.overview ? 39 : 12;
    this.orthographic.left = -h * this.aspect;
    this.orthographic.right = h * this.aspect;
    this.orthographic.top = h;
    this.orthographic.bottom = -h;
    this.orthographic.updateProjectionMatrix();
    this.perspective.aspect = this.aspect;
    this.perspective.updateProjectionMatrix();
    if (this.transition) setTransitionProjection(this.blendCamera, this.blendPose, this.aspect);
  }

  private applyBlend(pose: Pose): void {
    this.blendCamera.position.setFromSpherical(this.spherical.set(pose.radius, pose.phi, pose.theta)).add(this.focus);
    this.blendCamera.lookAt(this.focus);
    setTransitionProjection(this.blendCamera, pose, this.aspect);
    this.blendCamera.updateMatrixWorld();
  }

  update(dt: number, playerFeet: THREE.Vector3): void {
    dt = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, 0.1) : 0;
    this.desiredFocus.copy(this.overview ? this.center : playerFeet);
    if (!this.overview) this.desiredFocus.y += 1;
    if (this.encounter) {
      this.desiredFocus.copy(this.encounter.position).add(new THREE.Vector3(0, 1.25, 0));
      // Place the character in the open left portion, clear of the glass panel.
      if (this.viewportWidth > 760) this.desiredFocus.add(new THREE.Vector3(Math.cos(this.encounter.yaw), 0, -Math.sin(this.encounter.yaw)).multiplyScalar(thirdHeight(4.5) * this.aspect * .48));
      else this.desiredFocus.y -= 1.05;
    }
    if (this.transition) {
      const t = this.transition;
      t.elapsed += dt;
      const progress = this.reducedMotion ? 1 : Math.min(t.elapsed / TRANSITION_SECONDS, 1);
      const ease = progress * progress * (3 - 2 * progress);
      this.focus.lerpVectors(t.focus, this.desiredFocus, ease);
      const angle = Math.atan2(Math.sin(t.to.theta - t.from.theta), Math.cos(t.to.theta - t.from.theta));
      this.blendPose = { radius: THREE.MathUtils.lerp(t.from.radius, t.to.radius, ease),
        phi: THREE.MathUtils.lerp(t.from.phi, t.to.phi, ease), theta: t.from.theta + angle * ease,
        halfHeight: THREE.MathUtils.lerp(t.from.halfHeight, t.to.halfHeight, ease),
        perspective: THREE.MathUtils.lerp(t.from.perspective, t.to.perspective, ease) };
      this.applyBlend(this.blendPose);
      if (progress === 1) { this.transition = undefined; this.installPose(t.to); }
    } else {
      this.delta.subVectors(this.desiredFocus, this.focus).multiplyScalar(1 - Math.exp(-10 * dt));
      this.focus.add(this.delta);
      this.camera.position.add(this.delta);
      this.controls.target.copy(this.focus);
      this.controls.update(dt);
      this.camera.updateMatrixWorld();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const controls of [this.isoControls, this.thirdControls]) if (controls.domElement) controls.dispose();
  }
}
