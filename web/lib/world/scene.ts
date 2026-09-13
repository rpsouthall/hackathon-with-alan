import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import type { EnvironmentManifest, NpcSnapshot, PlayerSnapshot } from "./schema";

export interface SceneEntities { players: PlayerSnapshot[]; npcs: NpcSnapshot[]; localPlayerId: string | null }
export interface SceneCallbacks { onMove: (direction: [number, number], yaw: number) => void; onInteract: (id: string) => void; onStatus: (status: string, error?: string) => void }

function disposeObject(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      if (object instanceof THREE.SkinnedMesh) object.skeleton.dispose();
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value);
      }
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => { texture.dispose(); if (typeof ImageBitmap !== "undefined" && texture.image instanceof ImageBitmap) texture.image.close(); });
}

/** Renderer adapter only. Never owns authoritative player positions or NPC reservations. */
export function mountWorldScene(host: HTMLElement, environment: EnvironmentManifest, callbacks: SceneCallbacks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e7ede3");
  scene.add(new THREE.HemisphereLight("#fff5dd", "#728575", 2.5));
  const sun = new THREE.DirectionalLight("#fff2d8", 2); sun.position.set(8, 15, 6); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  camera.position.set(0, 13, 17); camera.lookAt(0, 0, 0);
  const fallback = new THREE.Group();
  const { min, max } = environment.bounds;
  const floor = new THREE.Mesh(new THREE.BoxGeometry(max[0] - min[0], 0.15, max[2] - min[2]), new THREE.MeshStandardMaterial({ color: "#adc29c" }));
  floor.position.set((min[0] + max[0]) / 2, environment.spawn[1] - 0.075, (min[2] + max[2]) / 2); fallback.add(floor);
  for (const box of environment.colliders) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...box.max.map((v, i) => v - box.min[i]) as [number, number, number]), new THREE.MeshStandardMaterial({ color: "#9a8971" }));
    mesh.position.set(...box.max.map((v, i) => (v + box.min[i]) / 2) as [number, number, number]); fallback.add(mesh);
  }
  scene.add(fallback);
  let stopped = false;
  let loaded: THREE.Object3D | null = null;
  if (environment.assetUrl) {
    callbacks.onStatus("loading");
    new GLTFLoader().load(environment.assetUrl, (gltf) => {
      if (stopped) { disposeObject(gltf.scene); return; }
      loaded = gltf.scene;
      // Blender markers are metadata, not visible geometry or gameplay state.
      loaded.traverse((object) => { if (object.name.startsWith("COLLIDER_") || object.name.startsWith("SPAWN_")) object.visible = false; });
      scene.add(loaded); fallback.visible = false; callbacks.onStatus("ready");
    }, undefined, () => { if (!stopped) callbacks.onStatus("fallback", "Environment could not load. Showing the walkable blockout."); });
  } else callbacks.onStatus("placeholder");

  const actors = new Map<string, { mesh: THREE.Mesh; target: THREE.Vector3; avatar?: THREE.Object3D; avatarUrl?: string | null; mixer?: THREE.AnimationMixer }>();
  let entities: SceneEntities = { players: [], npcs: [], localPlayerId: null };
  let enabled = true;
  const keys = new Set<string>();
  let step: { direction: [number, number]; until: number } | null = null;
  const movementKeys = new Set(["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"]);
  function resetInput() { keys.clear(); step = null; callbacks.onMove([0, 0], 0); }
  function keyDown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if (movementKeys.has(key)) { event.preventDefault(); if (enabled) keys.add(key); }
    if (key === "e" && !event.repeat && enabled) {
      const player = entities.players.find((p) => p.id === entities.localPlayerId);
      const nearby = player && entities.npcs.filter((npc) => Math.hypot(...npc.position.map((v, i) => v - player.position[i])) <= npc.interactionRadius).sort((a, b) => new THREE.Vector3(...a.position).distanceToSquared(new THREE.Vector3(...player.position)) - new THREE.Vector3(...b.position).distanceToSquared(new THREE.Vector3(...player.position)))[0];
      if (nearby) callbacks.onInteract(nearby.id);
    }
  }
  function keyUp(event: KeyboardEvent) { keys.delete(event.key.toLowerCase()); }
  const raycaster = new THREE.Raycaster();
  function click(event: MouseEvent) {
    host.focus();
    if (!enabled) return;
    const rect = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = raycaster.intersectObjects([...actors.values()].map((a) => a.mesh))[0];
    if (hit?.object.userData.npcId) callbacks.onInteract(hit.object.userData.npcId);
  }
  host.addEventListener("keydown", keyDown); host.addEventListener("keyup", keyUp);
  host.addEventListener("blur", resetInput); window.addEventListener("blur", resetInput);
  renderer.domElement.addEventListener("click", click);
  const resize = new ResizeObserver(() => {
    const width = Math.max(host.clientWidth, 1), height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height); camera.aspect = width / height; camera.updateProjectionMatrix();
  });
  resize.observe(host);
  let frame = 0, previous = performance.now(), lastInput = 0;
  const lookTarget = new THREE.Vector3();
  const render = (now: number) => {
    if (stopped) return;
    const delta = Math.min((now - previous) / 1000, 0.1); previous = now;
    for (const actor of actors.values()) { actor.mesh.position.lerp(actor.target, 1 - Math.exp(-18 * delta)); actor.mixer?.update(delta); }
    const local = actors.get(`player:${entities.localPlayerId}`);
    if (local) {
      lookTarget.copy(local.mesh.position); camera.position.lerp(lookTarget.clone().add(new THREE.Vector3(0, 12, 14)), 1 - Math.exp(-5 * delta)); camera.lookAt(lookTarget);
    }
    if (now - lastInput >= 50 && enabled) {
      const x = Number(keys.has("d") || keys.has("arrowright")) - Number(keys.has("a") || keys.has("arrowleft")) || (step && now < step.until ? step.direction[0] : 0);
      const z = Number(keys.has("s") || keys.has("arrowdown")) - Number(keys.has("w") || keys.has("arrowup")) || (step && now < step.until ? step.direction[1] : 0);
      callbacks.onMove([x, z], x || z ? Math.atan2(x, z) : 0); lastInput = now;
    }
    renderer.render(scene, camera); frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  return {
    step(direction: [number, number]) { if (enabled) step = { direction, until: performance.now() + 220 }; },
    update(next: SceneEntities, inputEnabled: boolean) {
      entities = next;
      if (enabled && !inputEnabled) resetInput();
      enabled = inputEnabled;
      const present = new Set<string>();
      const items = [
        ...next.players.map((p) => ({ key: `player:${p.id}`, position: p.position, color: p.id === next.localPlayerId ? "#346958" : "#487da0", npcId: null, avatarUrl: null })),
        ...next.npcs.map((npc) => ({ key: `npc:${npc.id}`, position: npc.position, color: "#be754d", npcId: npc.id, avatarUrl: npc.avatarUrl })),
      ];
      for (const item of items) {
        present.add(item.key);
        let actor = actors.get(item.key);
        if (!actor) {
          const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.8, 4, 8), new THREE.MeshStandardMaterial({ color: item.color }));
          mesh.userData.npcId = item.npcId;
          actor = { mesh, target: new THREE.Vector3() }; actors.set(item.key, actor); scene.add(mesh);
          mesh.position.set(item.position[0], item.position[1] + 0.7, item.position[2]);
        }
        actor.target.set(item.position[0], item.position[1] + 0.7, item.position[2]);
        if (actor.avatarUrl !== item.avatarUrl) {
          actor.avatarUrl = item.avatarUrl;
          actor.mixer?.stopAllAction(); actor.mixer = undefined;
          if (actor.avatar) { actor.mesh.remove(actor.avatar); disposeObject(actor.avatar); actor.avatar = undefined; }
          (actor.mesh.material as THREE.Material).visible = true;
          if (item.avatarUrl) {
            const owner = actor;
            new GLTFLoader().load(item.avatarUrl, (gltf) => {
              if (stopped || actors.get(item.key) !== owner || owner.avatarUrl !== item.avatarUrl) { disposeObject(gltf.scene); return; }
              owner.avatar = gltf.scene; owner.avatar.position.y = -0.7;
              owner.avatar.traverse((object) => { object.userData.npcId = item.npcId; });
              owner.mesh.add(owner.avatar); (owner.mesh.material as THREE.Material).visible = false;
              if (gltf.animations.length) {
                owner.mixer = new THREE.AnimationMixer(owner.avatar);
                owner.mixer.clipAction(gltf.animations.find((clip) => /idle/i.test(clip.name)) ?? gltf.animations[0]).play();
              }
            }, undefined, () => { if (!stopped) console.warn(`Character asset unavailable for ${item.key}; using placeholder.`); });
          }
        }
      }
      for (const [key, actor] of actors) if (!present.has(key)) { actor.mixer?.stopAllAction(); scene.remove(actor.mesh); disposeObject(actor.mesh); actors.delete(key); }
    },
    dispose() {
      stopped = true; cancelAnimationFrame(frame); resize.disconnect(); resetInput();
      host.removeEventListener("keydown", keyDown); host.removeEventListener("keyup", keyUp); host.removeEventListener("blur", resetInput); window.removeEventListener("blur", resetInput);
      renderer.domElement.removeEventListener("click", click);
      for (const actor of actors.values()) actor.mixer?.stopAllAction();
      disposeObject(scene); if (loaded && !loaded.parent) disposeObject(loaded);
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
