import * as THREE from "three";
import type { EnvironmentManifest } from "./schema";

const skyVertexShader = /* glsl */ `
  varying vec3 vDirection;
  void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    // The backdrop stays behind the town, including during projection blends.
    gl_Position.z = gl_Position.w * 0.99999;
  }
`;

const skyFragmentShader = /* glsl */ `
  varying vec3 vDirection;
  uniform vec3 sunDirection;
  uniform float daylight;
  uniform float time;
  uniform vec3 dayZenith;
  uniform vec3 dayHorizon;
  uniform vec3 nightZenith;
  uniform vec3 nightHorizon;
  uniform vec3 sunset;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
  }
  float noise(vec2 p) {
    vec2 cell = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), u.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), u.x), u.y);
  }
  float cloudNoise(vec2 p) {
    return noise(p) * 0.55 + noise(p * 2.03 + 5.0) * 0.27 + noise(p * 4.07) * 0.13;
  }
  void main() {
    vec3 direction = normalize(vDirection);
    float height = max(direction.y, 0.0);
    vec3 top = mix(nightZenith, dayZenith, daylight);
    vec3 horizon = mix(nightHorizon, dayHorizon, daylight);
    float dusk = 1.0 - smoothstep(0.02, 0.32, abs(sunDirection.y));
    float towardSun = dot(normalize(vec3(direction.x, 0.001, direction.z)),
      normalize(vec3(sunDirection.x, 0.001, sunDirection.z))) * 0.5 + 0.5;
    horizon = mix(horizon, sunset, dusk * (0.28 + towardSun * 0.45));
    vec3 color = mix(horizon, top, pow(height, 0.55));

    float sunAngle = max(dot(direction, sunDirection), 0.0);
    float sunVisible = smoothstep(-0.045, 0.025, sunDirection.y);
    color += vec3(1.0, 0.53, 0.22) * pow(sunAngle, 64.0) * 0.17 * sunVisible;
    color = mix(color, vec3(1.0, 0.89, 0.62), smoothstep(0.99945, 0.9997, sunAngle) * sunVisible);

    float moonAngle = max(dot(direction, -sunDirection), 0.0);
    float night = 1.0 - smoothstep(0.03, 0.35, daylight);
    color += vec3(0.24, 0.35, 0.57) * pow(moonAngle, 150.0) * 0.12 * night;
    color = mix(color, vec3(0.79, 0.85, 0.93), smoothstep(0.99968, 0.99985, moonAngle) * night);

    vec2 starUv = vec2(atan(direction.z, direction.x) / 6.2831853 + 0.5,
      asin(clamp(direction.y, -1.0, 1.0)) / 3.1415927 + 0.5) * vec2(500.0, 250.0);
    float starSeed = hash(floor(starUv));
    vec2 starOffset = vec2(hash(floor(starUv) + 13.0), hash(floor(starUv) + 61.0));
    float starDistance = length(fract(starUv) - (0.22 + starOffset * 0.56));
    float star = (1.0 - smoothstep(0.0, 0.13, starDistance)) * step(0.995, starSeed);
    color += vec3(0.68, 0.78, 1.0) * star * night * smoothstep(0.025, 0.15, height);

    // A slowly advected cloud sheet, without transparent meshes or depth sorting.
    vec2 cloudUv = direction.xz / max(direction.y + 0.22, 0.15) * 2.4;
    cloudUv += vec2(time * 0.003, time * 0.001);
    float cloud = smoothstep(0.51, 0.73, cloudNoise(cloudUv));
    cloud *= smoothstep(0.015, 0.18, height) * (1.0 - smoothstep(0.78, 1.0, height));
    vec3 cloudColor = mix(nightHorizon * 1.15, vec3(0.88, 0.91, 0.91), daylight);
    cloudColor = mix(cloudColor, sunset * 1.25, dusk * towardSun * 0.3);
    color = mix(color, cloudColor, cloud * 0.48);
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

/** Low, continuous ridges give the board a setting without adding playable space. */
function landscapeGeometry(inner: number, outer: number, peak: number, phase: number, meadow = false): THREE.BufferGeometry {
  const segments = 96, rings = meadow ? 12 : 7;
  const positions: number[] = [], colors: number[] = [], indices: number[] = [];
  for (let ring = 0; ring <= rings; ring++) {
    const t = ring / rings, radius = THREE.MathUtils.lerp(inner, outer, t);
    for (let segment = 0; segment <= segments; segment++) {
      const angle = segment / segments * Math.PI * 2;
      const crest = 0.54 + Math.sin(angle * 3 + phase) * 0.19 + Math.sin(angle * 7 - phase) * 0.12
        + Math.cos(angle * 11 + phase * 2) * 0.06;
      const shoulder = Math.pow(Math.sin(Math.PI * t), 0.85);
      const height = meadow
        ? Math.max(0, radius - 44) / outer * (Math.sin(angle * 4 + t * 9) + Math.cos(angle * 7 - t * 5)) * 1.1
        : crest * shoulder * peak;
      positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      // Broad, quiet color variation follows the terrain instead of random triangles.
      const shade = meadow ? 0.90 + Math.sin(angle * 5 + radius * 0.08) * 0.035
        : 0.76 + crest * 0.21 + Math.cos(angle - 0.7) * 0.045;
      colors.push(shade, shade, shade);
      if (ring < rings && segment < segments) {
        const a = ring * (segments + 1) + segment, b = a + segments + 1;
        indices.push(a, b + 1, b, a, a + 1, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export type SkyEnvironment = {
  update(hours: number, daylight: number, sunDirection: THREE.Vector3, elapsedSeconds: number): void;
  dispose(): void;
};

/** Procedural sky and distant Kyoto foothills. No downloaded textures or extra lights. */
export function createSkyEnvironment(scene: THREE.Scene, environment: EnvironmentManifest): SkyEnvironment {
  const center = new THREE.Vector3(
    (environment.bounds.min[0] + environment.bounds.max[0]) / 2, 0,
    (environment.bounds.min[2] + environment.bounds.max[2]) / 2,
  );
  const worldRadius = Math.hypot(environment.bounds.max[0] - environment.bounds.min[0],
    environment.bounds.max[2] - environment.bounds.min[2]) / 2;
  const group = new THREE.Group();
  group.name = "World atmosphere";
  group.position.copy(center);
  const skyMaterial = new THREE.ShaderMaterial({
    uniforms: {
      sunDirection: { value: new THREE.Vector3(-0.5, 0.7, 0.4).normalize() },
      daylight: { value: 1 }, time: { value: 0 },
      dayZenith: { value: new THREE.Color("#78b6d8") },
      dayHorizon: { value: new THREE.Color("#dddcc9") },
      nightZenith: { value: new THREE.Color("#0b142c") },
      nightHorizon: { value: new THREE.Color("#28354d") },
      sunset: { value: new THREE.Color("#e4a786") },
    },
    vertexShader: skyVertexShader, fragmentShader: skyFragmentShader,
    side: THREE.BackSide, depthWrite: false, depthTest: false, toneMapped: false,
  });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 40, 24), skyMaterial);
  sky.name = "Procedural sky";
  sky.renderOrder = -1000;
  sky.frustumCulled = false;
  group.add(sky);

  const materials: THREE.MeshBasicMaterial[] = [];
  const dayColors = [new THREE.Color("#9baa8d"), new THREE.Color("#77918b"), new THREE.Color("#91a6af")];
  const nightColors = [new THREE.Color("#273b42"), new THREE.Color("#24364b"), new THREE.Color("#2d3e56")];
  const baseY = environment.bounds.min[1] - 0.18;
  const radius = Math.max(44, worldRadius);
  const landscapeSpecs = [
    { name: "Outer meadow", inner: 0, outer: 180, peak: 0, phase: 0, meadow: true, y: baseY - 0.5 },
    { name: "Kyoto near foothills", inner: radius + 12, outer: radius + 70, peak: 25, phase: 0.8, meadow: false, y: baseY },
    { name: "Kyoto distant ridge", inner: radius + 64, outer: 178, peak: 44, phase: 2.7, meadow: false, y: baseY - 0.1 },
  ];
  for (const [index, spec] of landscapeSpecs.entries()) {
    const material = new THREE.MeshBasicMaterial({ color: dayColors[index], vertexColors: true, fog: true });
    const mesh = new THREE.Mesh(landscapeGeometry(spec.inner, spec.outer, spec.peak, spec.phase, spec.meadow), material);
    mesh.name = spec.name;
    mesh.position.y = spec.y;
    group.add(mesh);
    materials.push(material);
  }
  scene.add(group);
  let disposed = false;
  return {
    update(_hours, daylight, sunDirection, elapsedSeconds) {
      if (disposed) return;
      const day = THREE.MathUtils.clamp(daylight, 0, 1);
      skyMaterial.uniforms.daylight.value = day;
      skyMaterial.uniforms.sunDirection.value.copy(sunDirection).normalize();
      skyMaterial.uniforms.time.value = elapsedSeconds;
      for (let index = 0; index < materials.length; index++) materials[index].color.copy(nightColors[index]).lerp(dayColors[index], day);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      group.removeFromParent();
      for (const child of group.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
      }
      skyMaterial.dispose();
      for (const material of materials) material.dispose();
    },
  };
}
