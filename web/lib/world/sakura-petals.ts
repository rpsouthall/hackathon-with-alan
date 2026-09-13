import * as THREE from "three";
import type { EnvironmentManifest } from "./schema";

type Collider = NonNullable<EnvironmentManifest["physics"]>["colliders"][number];

function footprint(collider: Collider) {
  const inverse = new THREE.Matrix4().compose(
    new THREE.Vector3(...collider.position),
    new THREE.Quaternion(...collider.quaternion),
    new THREE.Vector3(1, 1, 1),
  ).invert().elements;
  return { inverse, x: collider.halfExtents[0], z: collider.halfExtents[2] };
}

function clearance(x: number, z: number, area: ReturnType<typeof footprint>) {
  const m = area.inverse;
  const dx = Math.max(0, Math.abs(m[0] * x + m[8] * z + m[12]) - area.x);
  const dz = Math.max(0, Math.abs(m[2] * x + m[10] * z + m[14]) - area.z);
  return Math.hypot(dx, dz);
}

/** One shared, folded petal silhouette; opaque triangles avoid particle sorting. */
function petalGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    0, -.48, 0, -.25, -.16, .04, -.34, .18, .09, -.19, .44, .07,
    0, .34, 0, .19, .44, .07, .34, .18, .09, .25, -.16, .04,
    0, .03, -.035,
  ], 3));
  geometry.setIndex([8, 0, 1, 8, 1, 2, 8, 2, 3, 8, 3, 4, 8, 4, 5, 8, 5, 6, 8, 6, 7, 8, 7, 0]);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createSakuraPetals(scene: THREE.Scene, environment: EnvironmentManifest, reducedMotion: boolean) {
  const colliders = environment.physics?.colliders ?? [];
  // landscape.py authors five cherry trees, then a pine (.005). The city adds
  // three explicitly named SakuraTrunk copies; their exported positions are Y-up.
  const trees = colliders.filter(({ name }) => /^SM_COL_(TreeTrunk(?:\.00[1-4])?|City_SakuraTrunk(?:\.\d+)?)$/.test(name ?? ""));
  if (reducedMotion || trees.length === 0) return { update() {}, dispose() {} };

  const interiors = colliders.filter(({ name, halfExtents }) =>
    /_ceiling$/.test(name ?? "") || (halfExtents[0] > 2 && halfExtents[2] > 2 && halfExtents[1] > 1.5),
  ).map(footprint);
  const lowSurfaces = colliders.filter(({ position, halfExtents }) =>
    halfExtents[1] < .4 && halfExtents[0] > .2 && halfExtents[2] > .2 && position[1] + halfExtents[1] < 1.6,
  ).map(collider => ({ ...footprint(collider), top: collider.position[1] + collider.halfExtents[1] }));
  const emitters = trees.slice(0, 8).map(tree => {
    let floor = Math.max(.3, tree.position[1] - tree.halfExtents[1] + .08);
    for (const surface of lowSurfaces) {
      if (clearance(tree.position[0], tree.position[2], surface) < 3.6) floor = Math.max(floor, surface.top);
    }
    return { x: tree.position[0], z: tree.position[2], floor: floor + .20, height: /City_/.test(tree.name ?? "") ? 4.15 : 5.0 };
  });

  let seed = 0x53414b55;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const particles = Array.from({ length: emitters.length * 36 }, (_, index) => ({
    emitter: emitters[index % emitters.length], phase: random(), duration: 19 + random() * 14,
    angle: random() * Math.PI * 2, radius: .4 + Math.sqrt(random()) * 1.65,
    flutter: random() * Math.PI * 2, size: .15 + random() * .13,
    tilt: .6 + random() * .6, spin: .35 + random() * .45,
  }));
  const geometry = petalGeometry();
  const material = new THREE.MeshStandardMaterial({
    color: "#ffffff", roughness: .94, metalness: 0, side: THREE.DoubleSide,
    emissive: "#9b4967", emissiveIntensity: .035, depthTest: true, depthWrite: true,
  });
  const petals = new THREE.InstancedMesh(geometry, material, particles.length);
  petals.name = "Sakura drifting petals";
  petals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  petals.castShadow = false;
  petals.receiveShadow = false;
  // The particles move, so a one-time instance bounding sphere would become stale.
  petals.frustumCulled = false;
  const tint = new THREE.Color();
  const palette = ["#ffd8e4", "#f4afc9", "#fff0f3", "#e99fb9"];
  for (let i = 0; i < particles.length; i++) petals.setColorAt(i, tint.set(palette[i % palette.length]));
  scene.add(petals);

  const transform = new THREE.Object3D();
  let elapsed = 0;
  let disposed = false;
  const update = (dt: number, daylight: number) => {
    if (disposed) return;
    const delta = Number.isFinite(dt) ? THREE.MathUtils.clamp(dt, 0, .1) : 0;
    elapsed += delta;
    material.emissiveIntensity = .025 + .055 * (1 - THREE.MathUtils.clamp(daylight, 0, 1));
    for (let i = 0; i < particles.length; i++) {
      const petal = particles[i];
      petal.phase = (petal.phase + delta / petal.duration) % 1;
      const progress = petal.phase;
      const sway = elapsed * .6 + petal.flutter;
      const x = petal.emitter.x + Math.cos(petal.angle) * petal.radius + (progress - .5) * 1.5 + Math.sin(sway) * .35;
      const z = petal.emitter.z + Math.sin(petal.angle) * petal.radius + (progress - .5) * .7 + Math.cos(sway * .8) * .3;
      const y = THREE.MathUtils.lerp(petal.emitter.height, petal.emitter.floor, progress);
      // Scale gently to zero at both loop ends, so respawning cannot pop. The
      // same smooth margin prevents drift through an open shop's cutaway roof.
      let visibility = THREE.MathUtils.smoothstep(progress, 0, .09) * (1 - THREE.MathUtils.smoothstep(progress, .84, 1));
      for (const interior of interiors) visibility *= THREE.MathUtils.smoothstep(clearance(x, z, interior), .12, .65);
      const edge = Math.min(x - environment.bounds.min[0], environment.bounds.max[0] - x, z - environment.bounds.min[2], environment.bounds.max[2] - z);
      visibility *= THREE.MathUtils.smoothstep(edge, .15, .75);
      transform.position.set(x, y, z);
      transform.rotation.set(Math.sin(sway * 1.8) * petal.tilt, elapsed * petal.spin + petal.flutter, Math.sin(sway) * .8);
      transform.scale.setScalar(petal.size * visibility);
      transform.updateMatrix();
      petals.setMatrixAt(i, transform.matrix);
    }
    petals.instanceMatrix.needsUpdate = true;
  };
  update(0, 1);

  return {
    update,
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(petals);
      petals.dispose();
      geometry.dispose();
      material.dispose();
    },
  };
}
