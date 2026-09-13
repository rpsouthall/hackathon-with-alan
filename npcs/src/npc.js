import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

import { PRESETS, ANIMATIONS, MATERIAL_CHANNELS, validateAppearance } from './appearance.js';
export { PRESETS, ANIMATIONS, MATERIAL_CHANNELS, validateAppearance } from './appearance.js';
import { CITY_PRESETS } from './city-cast.js';
export { CITY_PRESETS } from './city-cast.js';

export async function loadNPCAsset(url = new URL('../exports/komorebi_npc.glb', import.meta.url)) {
  return new GLTFLoader().loadAsync(String(url));
}

export class VoxelNPC {
  constructor(asset, appearance = {}) {
    const validated=validateAppearance(appearance);
    for(const name of ANIMATIONS) if(!asset.animations.some(clip=>clip.name===`AN_NPC_${name}`)) throw new Error(`Missing animation ${name}.`);
    this.object = new THREE.Group();
    this.object.name = 'NPC';
    this.model = clone(asset.scene);
    this.object.add(this.model);
    this.materials = new Set();
    const materialCopies = new Map();
    this.model.traverse(node => {
      if (!node.isMesh) return;
      const copy = material => {
        if (!materialCopies.has(material)) materialCopies.set(material, material.clone());
        const result=materialCopies.get(material); this.materials.add(result); return result;
      };
      node.material = Array.isArray(node.material) ? node.material.map(copy) : copy(node.material);
      node.castShadow = true; node.receiveShadow = true;
      // Animated bounds can exceed bind-pose bounds; small cast, reliable visibility.
      node.frustumCulled = false;
    });
    this.clips = asset.animations;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = Object.fromEntries(this.clips.map(clip => [clip.name.replace(/^AN_NPC_/,''),this.mixer.clipAction(clip)]));
    for (const name of ANIMATIONS) if (!this.actions[name]) throw new Error(`Missing animation ${name}.`);
    this.time = 0; this.mouthLevel = 0; this.blinkEnabled = true; this.disposed = false;
    this._blinkSeed = Math.random()*3;
    this._finished = event => { if(event.action===this.actions[this.current]) this.play('Idle'); };
    this.mixer.addEventListener('finished', this._finished);
    this.setAppearance(validated);
    this.play('Idle', { fade:0 });
  }

  setAppearance(patch) {
    if(this.disposed)return this;
    this.appearance = validateAppearance({ ...this.appearance, ...patch });
    const c = this.appearance;
    this.object.name = `NPC_${c.id}`;
    this.object.userData.npcId = c.id;
    this.model.traverse(node => {
      const part = node.userData.npc_part, option = node.userData.npc_option;
      if (part === 'hair' || part === 'outfit') node.visible = c[part] === option;
      if (part === 'glasses' || part === 'bag') node.visible = c[part];
    });
    for (const material of this.materials) {
      for (const [channel, name] of Object.entries(MATERIAL_CHANNELS)) {
        if (material.name === `MAT_NPC_${name}`) material.color.set(c[channel]);
      }
    }
    const authoredHeight = { crop:1.775, bob:1.75, topknot:1.875 }[c.hair];
    this.model.scale.setScalar(c.height / authoredHeight);
    this.object.userData.appearance = this.toJSON();
    return this;
  }

  play(name, { fade = .18, once = false, speed = 1 } = {}) {
    if(this.disposed)return this;
    const next = this.actions[name];
    if (!next) throw new RangeError(`Unknown animation: ${name}`);
    if(!Number.isFinite(fade)||fade<0||!Number.isFinite(speed)||speed<=0)throw new RangeError('Animation timing must be finite; fade must be nonnegative and speed positive.');
    if (this.current === name && next.isRunning() && next.loop===(once ? THREE.LoopOnce : THREE.LoopRepeat)) { next.setEffectiveTimeScale(speed); return this; }
    const previous = this.actions[this.current];
    next.reset().setEffectiveTimeScale(speed).setEffectiveWeight(1);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    if (previous && previous !== next && fade > 0) next.crossFadeFrom(previous,fade,false);
    else if (previous && previous !== next) previous.stop();
    this.current = name;
    return this;
  }

  /** World-space velocity after collision resolution, in metres per second. */
  setVelocity(velocity) {
    const speed = Math.hypot(velocity.x,velocity.z);
    if (!Number.isFinite(speed) || speed < .025) { if (['Walk','Run'].includes(this.current)) this.play('Idle'); return; }
    const state = speed > 1.7 ? 'Run' : 'Walk';
    const authoredSpeed = state === 'Run' ? 1.32 : .72;
    this.play(state,{ speed:THREE.MathUtils.clamp(speed/(authoredSpeed*this.model.scale.x),.35,3.5) });
  }

  /** Audio RMS/envelope in [0,1], driven by the actual outgoing voice later. */
  setSpeechLevel(level) { this.mouthLevel = Number.isFinite(level) ? THREE.MathUtils.clamp(level,0,1) : 0; }

  getSocket(name = 'socket_voice', target = new THREE.Vector3()) {
    const socket = this.model.getObjectByName(name);
    if (!socket) throw new Error(`Unknown socket ${name}.`);
    this.object.updateMatrixWorld(true);
    return socket.getWorldPosition(target);
  }

  update(dt) {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    dt = Math.min(dt,.1); this.time += dt; this.mixer.update(dt);
    const phase=(this.time+this._blinkSeed)%4.1;
    const blink=this.blinkEnabled && phase<.16 ? Math.sin(phase/.16*Math.PI) : 0;
    this.model.traverse(node => {
      const targets=node.morphTargetDictionary;
      if (!targets) return;
      if ('Blink' in targets) node.morphTargetInfluences[targets.Blink]=blink;
      if ('MouthOpen' in targets) node.morphTargetInfluences[targets.MouthOpen]=this.mouthLevel;
    });
  }

  toJSON() { return { ...this.appearance }; }

  /** Geometry belongs to the cached template; only per-instance resources are freed. */
  dispose() {
    if (this.disposed) return;
    this.disposed=true;
    this.mixer.removeEventListener('finished',this._finished);
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    this.materials.forEach(material=>material.dispose());
    const skeletons = new Set();
    this.model.traverse(node=>{ if (node.skeleton) skeletons.add(node.skeleton); });
    skeletons.forEach(skeleton=>skeleton.dispose());
    this.object.removeFromParent();
  }
}

/** Lightweight patrol on caller-provided waypoints. Supply a physics resolver for a real level. */
export class NPCPatrol {
  constructor(npc, points, { speed=.9, wait=1.4, resolveMovement=null }={}) {
    if (!Array.isArray(points) || points.length<2 || points.some(p=>!p?.isVector3 || ![p.x,p.y,p.z].every(Number.isFinite))) throw new TypeError('Patrol needs at least two finite Vector3 waypoints.');
    if (!Number.isFinite(speed) || speed<=0 || !Number.isFinite(wait) || wait<0) throw new RangeError('Invalid patrol timing.');
    this.npc=npc; this.points=points.map(p=>p.clone()); this.index=0;
    this.speed=speed; this.wait=wait; this.pause=0; this.resolveMovement=resolveMovement; this.enabled=true;
    this._delta=new THREE.Vector3(); this._velocity=new THREE.Vector3();
  }
  update(dt) {
    if (!this.enabled || !Number.isFinite(dt) || dt<=0) return;
    dt=Math.min(dt,.1);
    if (this.pause>0) { this.pause-=dt; this.npc.setVelocity(this._velocity.set(0,0,0)); return; }
    const pos=this.npc.object.position, target=this.points[this.index];
    this._delta.subVectors(target,pos);
    const distance=this._delta.length();
    if (distance<.025) { this.index=(this.index+1)%this.points.length; this.pause=this.wait; this.npc.setVelocity(this._velocity.set(0,0,0)); return; }
    this._delta.multiplyScalar(Math.min(this.speed*dt,distance)/distance);
    const proposed=pos.clone().add(this._delta);
    const resolved=this.resolveMovement ? this.resolveMovement(pos.clone(),proposed,this.npc) : proposed;
    if (!resolved?.isVector3 || ![resolved.x,resolved.y,resolved.z].every(Number.isFinite)) throw new TypeError('Movement resolver must return a finite Vector3 foot position.');
    this._velocity.subVectors(resolved,pos).divideScalar(dt);
    pos.copy(resolved);
    if (Math.hypot(this._velocity.x,this._velocity.z)>.025) {
      const yaw=Math.atan2(this._velocity.x,this._velocity.z);
      const diff=Math.atan2(Math.sin(yaw-this.npc.object.rotation.y),Math.cos(yaw-this.npc.object.rotation.y));
      this.npc.object.rotation.y+=diff*(1-Math.exp(-dt*10));
    }
    this.npc.setVelocity(this._velocity);
  }
}

/** Scene marker adapter for kyoto/exports/kyoto_gameplay.json. Positions are already Y up. */
export function spawnAtMarkers(asset, gameplay, scene) {
  const ids=new Set();
  return gameplay.markers.filter(marker=>['npc','npc_spawn'].includes(marker.properties?.kind)).map(marker=>{
    const id=marker.properties.npc_id;
    if(typeof id!=='string' || !id || ids.has(id)) throw new TypeError(`Invalid or duplicate NPC marker id: ${id}`);
    if(!Array.isArray(marker.position) || marker.position.length!==3 || !marker.position.every(Number.isFinite)) throw new TypeError(`Invalid NPC position: ${id}`);
    ids.add(id);
    const npc=new VoxelNPC(asset, CITY_PRESETS[id] ?? {id});
    npc.object.position.fromArray(marker.position);
    const target=gameplay.markers.find(other=>other.name===`MARK_interaction_${marker.properties.venue_id}`);
    npc.object.rotation.y=marker.properties.facing_yaw ?? (target ? Math.atan2(target.position[0]-marker.position[0],target.position[2]-marker.position[2]) : ({north:Math.PI,south:0,east:Math.PI/2,west:-Math.PI/2}[marker.properties.facing] ?? 0));
    npc.object.userData.interactionRadius=marker.properties.interaction_radius ?? 2.2;
    npc.object.userData.venueId=marker.properties.venue_id ?? null;
    scene.add(npc.object); return npc;
  });
}
