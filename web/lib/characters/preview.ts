import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { PlayerAppearance } from "../world/schema";
import { createAvatar, disposeAvatarTemplate, loadAvatarTemplate, type AvatarAnimation, type CharacterAvatar } from "./avatar";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

/** Editor-only viewer. It never modifies game state or publishes cosmetic changes. */
export function mountAvatarPreview(
  host: HTMLElement,
  appearance: PlayerAppearance,
  onStatus?: (message: string) => void,
): { setAppearance: (appearance: PlayerAppearance) => void; play: (name: AvatarAnimation) => void; dispose: () => void } {
  let currentAppearance = appearance;
  let disposed = false;
  let template: GLTF | undefined;
  let avatar: CharacterAvatar | undefined;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#e9e6dc");
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = "block";
  // The high-DPI drawing buffer must not contribute an intrinsic flex height:
  // otherwise ResizeObserver can repeatedly grow the stage from that buffer.
  renderer.domElement.style.position = "absolute";
  renderer.domElement.style.inset = "0";
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 30);
  camera.position.set(2.9, 1.9, 4.7);
  camera.lookAt(0, 1, 0);
  const controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0,1,0); controls.enablePan=false; controls.minDistance=2.5; controls.maxDistance=7; controls.maxPolarAngle=Math.PI/2; controls.update();
  scene.add(new THREE.HemisphereLight("#ffffff", "#9d9682", 2.6));
  const light = new THREE.DirectionalLight("#fff4db", 3);
  light.position.set(-3, 6, 4);
  light.castShadow = true;
  light.shadow.mapSize.set(512, 512);
  light.shadow.camera.left = -3;
  light.shadow.camera.right = 3;
  light.shadow.camera.top = 3;
  light.shadow.camera.bottom = -3;
  scene.add(light);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.3, 48), new THREE.MeshStandardMaterial({ color: "#d5d3c6", roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.003;
  floor.receiveShadow = true;
  scene.add(floor);
  const resize = () => {
    if (disposed) return;
    const width = Math.max(host.clientWidth, 1);
    const height = Math.max(host.clientHeight, 1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  let resizePending = false;
  const observer = new ResizeObserver(() => { resizePending = true; });
  observer.observe(host);
  resize();
  onStatus?.("Loading character…");
  void loadAvatarTemplate().then((asset) => {
    if (disposed) { disposeAvatarTemplate(asset); return; }
    template = asset;
    avatar = createAvatar(asset, currentAppearance);
    scene.add(avatar.object);
    onStatus?.("Character ready");
  }).catch(() => { if (!disposed) onStatus?.("Character preview could not load."); });

  let previous = performance.now();
  let frame = 0;
  const tick = (now: number) => {
    if (disposed) return;
    if (resizePending) { resizePending = false; resize(); }
    avatar?.update(Math.min((now - previous) / 1000, 0.1));
    previous = now;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  return {
    setAppearance(next) { currentAppearance = next; avatar?.setAppearance(next); },
    play(name) { avatar?.play(name, { once: name === "Wave" || name === "Bow" }); },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      avatar?.dispose();
      if (template) disposeAvatarTemplate(template);
      floor.geometry.dispose();
      floor.material.dispose();
      light.shadow.map?.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
}
