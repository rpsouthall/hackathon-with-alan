import * as THREE from "three";
import type { EnvironmentManifest } from "./schema";

/** Lighting follows the world clock, independently of camera/player movement. */
export function addWorldLighting(scene: THREE.Scene, renderer: THREE.WebGLRenderer, environment: EnvironmentManifest) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const sky = new THREE.Color("#c2d7df");
  scene.background = sky;
  const fog = new THREE.Fog(sky, 72, 195);
  scene.fog = fog;
  const hemisphere = new THREE.HemisphereLight("#dcecff", "#938372", 1.45);
  scene.add(hemisphere);
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
  // A constant world-sized frustum avoids shadow-map scale shimmer as the sun moves.
  const radius = new THREE.Vector3(...environment.bounds.max).sub(new THREE.Vector3(...environment.bounds.min)).length() / 2 + 3;
  const distance = radius * 2;
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: distance - radius, far: distance + radius });
  sun.shadow.camera.updateProjectionMatrix();
  // Soft sky fill separates dark timber and the shaded side of characters.
  const fill = new THREE.DirectionalLight("#c6ddff", .35);
  fill.position.copy(center).add(new THREE.Vector3(30, 18, -35));
  fill.target.position.copy(center);
  scene.add(fill, fill.target);
  const moon = new THREE.DirectionalLight("#adc5ff", 0);
  moon.target.position.copy(center);
  scene.add(moon, moon.target);
  const points: { light: THREE.PointLight; intensity: number }[] = [];
  for (const light of environment.lights ?? []) {
    const point = new THREE.PointLight(new THREE.Color(...light.color), light.intensity, light.range, 2);
    point.position.fromArray(light.position);
    scene.add(point);
    points.push({ light: point, intensity: light.intensity });
  }
  const colors = {
    skyDay: new THREE.Color("#c2d7df"), skyNight: new THREE.Color("#202c4c"), skyDusk: new THREE.Color("#d59e91"),
    upperDay: new THREE.Color("#dcecff"), upperNight: new THREE.Color("#869ccd"),
    lowerDay: new THREE.Color("#938372"), lowerNight: new THREE.Color("#42465c"),
    sunDay: new THREE.Color("#fff0d4"), sunDusk: new THREE.Color("#ffa96e"),
  };
  return {
    update(_hours: number, daylight: number, sunDirection: THREE.Vector3) {
      const twilight = Math.max(0, 1 - Math.abs(sunDirection.y) / .38);
      sky.copy(colors.skyNight).lerp(colors.skyDay, daylight).lerp(colors.skyDusk, twilight * .48);
      fog.color.copy(sky);
      hemisphere.color.copy(colors.upperNight).lerp(colors.upperDay, daylight);
      hemisphere.groundColor.copy(colors.lowerNight).lerp(colors.lowerDay, daylight);
      hemisphere.intensity = .65 + daylight * .80;
      sun.position.copy(center).addScaledVector(sunDirection, distance);
      sun.color.copy(colors.sunDay).lerp(colors.sunDusk, twilight);
      sun.intensity = Math.max(0, sunDirection.y) * 2.6 + daylight * .4 * THREE.MathUtils.smoothstep(sunDirection.y, 0, .12);
      sun.shadow.intensity = .8 * daylight;
      fill.intensity = .12 + .23 * daylight;
      moon.position.copy(center).addScaledVector(sunDirection, -distance);
      moon.intensity = .48 * (1 - daylight);
      renderer.toneMappingExposure = .94 + .06 * daylight;
      for (const point of points) point.light.intensity = point.intensity * (.55 + 1.05 * (1 - daylight));
    },
    dispose() {
      for (const light of [hemisphere, sun, fill, moon, ...points.map(point => point.light)]) { scene.remove(light); light.dispose(); }
      scene.remove(sun.target, fill.target, moon.target);
      if (scene.fog === fog) scene.fog = null;
      if (scene.background === sky) scene.background = null;
    },
  };
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
