import * as THREE from "three";
import type { EnvironmentManifest } from "./schema";

/** A fixed world-space sun keeps shadows stable while the isometric camera moves. */
export function addWorldLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, environment: EnvironmentManifest) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const sky = new THREE.Color("#cedce4");
  scene.background = sky;
  scene.fog = new THREE.Fog(sky, 90, 170);
  scene.add(new THREE.HemisphereLight("#dcecff", "#938372", 1.45));
  const sun = new THREE.DirectionalLight("#ffe4bd", 3);
  const center = new THREE.Vector3().addVectors(new THREE.Vector3(...environment.bounds.min), new THREE.Vector3(...environment.bounds.max)).multiplyScalar(.5);
  sun.target.position.copy(center);
  sun.position.copy(center).add(new THREE.Vector3(-38, 60, 30));
  sun.castShadow = true;
  const resolution = Math.min(4096, renderer.capabilities.maxTextureSize);
  sun.shadow.mapSize.set(resolution, resolution);
  sun.shadow.bias = -.00012;
  sun.shadow.normalBias = .035;
  sun.shadow.intensity = .85;
  sun.shadow.radius = 2;
  scene.add(sun, sun.target);
  fitSunShadow(sun, new THREE.Box3(new THREE.Vector3(...environment.bounds.min), new THREE.Vector3(...environment.bounds.max)));
  // Soft sky fill separates dark timber and the shaded side of characters.
  const fill = new THREE.DirectionalLight("#c6ddff", .35);
  fill.position.copy(center).add(new THREE.Vector3(30, 18, -35));
  fill.target.position.copy(center);
  scene.add(fill, fill.target);
  for (const light of environment.lights ?? []) {
    const point = new THREE.PointLight(new THREE.Color(...light.color), light.intensity, light.range, 2);
    point.position.fromArray(light.position);
    scene.add(point);
  }
}

export function fitSunShadow(sun: THREE.DirectionalLight, bounds: THREE.Box3) {
  const camera = sun.shadow.camera;
  camera.position.copy(sun.position);
  camera.lookAt(sun.target.position);
  camera.updateMatrixWorld(true);
  const lightBounds = bounds.clone().applyMatrix4(camera.matrixWorldInverse);
  const padding = 2;
  camera.left = lightBounds.min.x - padding;
  camera.right = lightBounds.max.x + padding;
  camera.bottom = lightBounds.min.y - padding;
  camera.top = lightBounds.max.y + padding;
  camera.near = Math.max(.1, -lightBounds.max.z - padding);
  camera.far = Math.max(camera.near + 1, -lightBounds.min.z + padding);
  camera.updateProjectionMatrix();
}
