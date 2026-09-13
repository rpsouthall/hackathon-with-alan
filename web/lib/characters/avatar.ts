import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { appearanceSchema, type PlayerAppearance } from "../world/schema";
import { ANIMATIONS, CHARACTER_PRESETS, MATERIAL_CHANNELS, type AvatarAnimation } from "./presets";
import { createExtraEmoteClips } from "./emote-clips";
import { EMOTES, type EmoteName } from "../world/player-actions";
import { AvatarRidingPose, type RidingState } from "./riding-pose";

export { ANIMATIONS, CHARACTER_PRESETS } from "./presets";
export type { AvatarAnimation } from "./presets";

export const AVATAR_ASSET_URL = "/models/characters/komorebi_npc.glb";

/** Call once per scene runtime and share the resolved template between all actors. */
export function loadAvatarTemplate(url = AVATAR_ASSET_URL): Promise<GLTF> {
  return new GLTFLoader().loadAsync(url);
}

export type AnimationOptions = { fade?: number; once?: boolean; speed?: number; restart?: boolean };

/** Independent skeleton, face and materials over shared, immutable template geometry. */
export class CharacterAvatar {
  readonly object = new THREE.Group();
  readonly model: THREE.Object3D;
  readonly materials = new Set<THREE.Material>();
  readonly mixer: THREE.AnimationMixer;
  readonly actions: Record<AvatarAnimation, THREE.AnimationAction>;
  appearance: PlayerAppearance;
  current: AvatarAnimation = "Idle";
  blinkEnabled = true;

  private time = 0;
  private mouthLevel = 0;
  private disposed = false;
  private readonly blinkSeed = Math.random() * 3;
  private readonly faceMeshes: THREE.Mesh[] = [];
  private readonly ridingPose: AvatarRidingPose;
  private readonly finished = (event: THREE.AnimationMixerEventMap["finished"]) => {
    // A fading gesture can finish after a new action has already started.
    if (event.action === this.actions[this.current]) this.play("Idle");
  };

  constructor(template: GLTF, appearance: Partial<PlayerAppearance> = {}) {
    // Validate before allocating a clone, so malformed imports cannot leak resources.
    this.appearance = appearanceSchema.parse({ ...CHARACTER_PRESETS.local_guide.appearance, ...appearance });
    const clips = new Map(template.animations.map((clip) => [clip.name.replace(/^AN_NPC_/, ""), clip]));
    for (const name of ANIMATIONS) {
      if (!clips.has(name)) throw new Error(`Character template is missing animation ${name}.`);
    }
    for (const clip of createExtraEmoteClips(clips.get("Idle")!)) clips.set(clip.name, clip);

    this.object.name = "Avatar";
    this.model = clone(template.scene);
    this.object.add(this.model);
    this.ridingPose = new AvatarRidingPose(this.model);
    const materialCopies = new Map<THREE.Material, THREE.Material>();
    this.model.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return;
      const copy = (material: THREE.Material) => {
        let result = materialCopies.get(material);
        if (!result) {
          result = material.clone();
          materialCopies.set(material, result);
          this.materials.add(result);
        }
        return result;
      };
      node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      node.castShadow = true;
      node.receiveShadow = true;
      // Small cast: avoid bind-pose bounds hiding raised hands or animated accessories.
      node.frustumCulled = false;
      if (node.morphTargetDictionary && node.morphTargetInfluences) this.faceMeshes.push(node);
    });
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = Object.fromEntries([...clips].map(([name, clip]) => [name, this.mixer.clipAction(clip)])) as Record<AvatarAnimation, THREE.AnimationAction>;
    this.mixer.addEventListener("finished", this.finished);
    this.setAppearance(this.appearance);
    this.play("Idle", { fade: 0 });
  }

  setAppearance(patch: Partial<PlayerAppearance>): this {
    if (this.disposed) return this;
    this.appearance = appearanceSchema.parse({ ...this.appearance, ...patch });
    const appearance = this.appearance;
    this.model.traverse((node) => {
      const part: unknown = node.userData.npc_part;
      const option: unknown = node.userData.npc_option;
      if (part === "hair" || part === "outfit") node.visible = appearance[part] === option;
      if (part === "glasses" || part === "bag") node.visible = appearance[part];
    });
    for (const material of this.materials) {
      const color = "color" in material ? material.color : null;
      if (!(color instanceof THREE.Color)) continue;
      for (const [channel, name] of Object.entries(MATERIAL_CHANNELS)) {
        if (material.name === `MAT_NPC_${name}`) color.set(appearance[channel as keyof typeof MATERIAL_CHANNELS]);
      }
    }
    const authoredHeight = { crop: 1.775, bob: 1.75, topknot: 1.875 }[appearance.hair];
    this.model.scale.setScalar(appearance.height / authoredHeight);
    this.object.userData.appearance = this.toJSON();
    return this;
  }

  play(name: AvatarAnimation, { fade = 0.18, once = false, speed = 1, restart = false }: AnimationOptions = {}): this {
    if (this.disposed) return this;
    const next = this.actions[name];
    if (!next) throw new RangeError(`Unknown animation: ${name}`);
    if (!Number.isFinite(fade) || fade < 0 || !Number.isFinite(speed) || speed <= 0) throw new RangeError("Animation fade and speed must be finite and positive (fade may be zero).");
    const loop = once ? THREE.LoopOnce : THREE.LoopRepeat;
    if (!restart && this.current === name && next.isRunning() && next.loop === loop) {
      next.setEffectiveTimeScale(speed);
      return this;
    }
    const previous = this.actions[this.current];
    next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
    next.setLoop(loop, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (previous !== next) {
      if (fade > 0) next.crossFadeFrom(previous, fade, false);
      else previous.stop();
    }
    this.current = name;
    return this;
  }

  playEmote(name: EmoteName, elapsed = 0): void {
    if (this.disposed) return;
    const { animation, duration } = EMOTES[name];
    const clip = this.actions[animation].getClip();
    this.play(animation, { once: true, restart: true, fade: elapsed > 0.18 ? 0 : 0.18, speed: clip.duration / duration });
    this.actions[animation].time = THREE.MathUtils.clamp(Number.isFinite(elapsed) ? elapsed : 0, 0, duration) * clip.duration / duration;
    this.mixer.update(0);
  }

  /** Supply actual velocity after authoritative movement; never moves the actor root. */
  setVelocity(velocity: THREE.Vector3, gait?: "walk" | "run"): void {
    if (this.ridingPose.kind) return;
    const speed = Math.hypot(velocity.x, velocity.z);
    if (!Number.isFinite(speed) || speed < 0.025) {
      if (this.current === "Walk" || this.current === "Run") this.play("Idle");
      return;
    }
    const animation = gait ? gait === "run" ? "Run" : "Walk" : speed > 1.7 ? "Run" : "Walk";
    const authoredSpeed = animation === "Run" ? 1.32 : 0.72;
    this.play(animation, { speed: THREE.MathUtils.clamp(speed / (authoredSpeed * this.model.scale.x), 0.35, 3.5) });
  }

  /** Riding is a separate reversible visual layer over the original seven clips. */
  setRiding(state: RidingState | null): void {
    if (this.disposed) return;
    if (state && this.ridingPose.kind !== state.kind) this.play("Idle", { fade: .1 });
    this.ridingPose.set(state);
  }

  get riding(): RidingState["kind"] | null { return this.ridingPose.kind; }

  /** Actual outgoing voice audio envelope, not a synthetic indication that voice works. */
  setSpeechLevel(level: number): void {
    this.mouthLevel = Number.isFinite(level) ? THREE.MathUtils.clamp(level, 0, 1) : 0;
  }

  getSocket(name = "socket_voice", target = new THREE.Vector3()): THREE.Vector3 {
    const socket = this.model.getObjectByName(name);
    if (!socket) throw new Error(`Unknown avatar socket ${name}.`);
    this.object.updateMatrixWorld(true);
    return socket.getWorldPosition(target);
  }

  update(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    this.ridingPose.restore();
    this.mixer.update(dt);
    this.ridingPose.apply(dt);
    const phase = (this.time + this.blinkSeed) % 4.1;
    const blink = this.blinkEnabled && phase < 0.16 ? Math.sin(phase / 0.16 * Math.PI) : 0;
    for (const mesh of this.faceMeshes) {
      const targets = mesh.morphTargetDictionary!;
      const influences = mesh.morphTargetInfluences!;
      if ("Blink" in targets) influences[targets.Blink] = blink;
      if ("MouthOpen" in targets) influences[targets.MouthOpen] = this.mouthLevel;
    }
  }

  toJSON(): PlayerAppearance { return { ...this.appearance }; }

  /** Template geometry/textures stay alive until the scene owner disposes the template. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.ridingPose.restore();
    this.mixer.removeEventListener("finished", this.finished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    for (const material of this.materials) material.dispose();
    const skeletons = new Set<THREE.Skeleton>();
    this.model.traverse((node) => { if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton); });
    for (const skeleton of skeletons) skeleton.dispose();
    this.object.removeFromParent();
  }
}

export function createAvatar(template: GLTF, appearance: Partial<PlayerAppearance> = {}): CharacterAvatar {
  return new CharacterAvatar(template, appearance);
}

const disposedTemplates = new WeakSet<GLTF>();

/** Call after every instance is disposed, including templates that finished loading late. */
export function disposeAvatarTemplate(template: GLTF): void {
  if (disposedTemplates.has(template)) return;
  disposedTemplates.add(template);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  template.scene.traverse((node) => {
    if (node instanceof THREE.SkinnedMesh) skeletons.add(node.skeleton);
    if (!(node instanceof THREE.Mesh)) return;
    geometries.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) materials.add(material);
  });
  for (const material of materials) {
    for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
    material.dispose();
  }
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  const bitmaps = new Set<ImageBitmap>();
  for (const texture of textures) {
    if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) bitmaps.add(texture.image);
    texture.dispose();
  }
  for (const bitmap of bitmaps) bitmap.close();
}
