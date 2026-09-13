import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { KYOTO_ENVIRONMENT } from "../../lib/world/kyoto";
import { createSakuraPetals } from "../../lib/world/sakura-petals";

test("sakura stays above ground and outside real shop interiors throughout complete flights", () => {
  const scene = new THREE.Scene();
  const runtime = createSakuraPetals(scene, KYOTO_ENVIRONMENT, false);
  const mesh = scene.getObjectByName("Sakura drifting petals") as THREE.InstancedMesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  assert.equal(mesh.count, 288, "eight authored cherry trees, with no petals emitted by the pine");
  assert.equal(mesh.material.transparent, false);
  assert.equal(mesh.material.depthTest, true);
  assert.equal(mesh.material.depthWrite, true);
  assert.equal(mesh.castShadow, false);
  const interiors = KYOTO_ENVIRONMENT.physics!.colliders.filter(collider => /_ceiling$/.test(collider.name ?? ""));
  const matrix = new THREE.Matrix4(), position = new THREE.Vector3(), local = new THREE.Vector3();
  const rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
  for (let frame = 0; frame < 680; frame++) {
    runtime.update(.1, frame / 680);
    if (frame % 10) continue;
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, matrix);
      matrix.decompose(position, rotation, scale);
      if (scale.x < .001) continue;
      assert.ok(position.y - scale.x > .3, "petals shrink away before touching the ground");
      assert.ok(position.x > -34 && position.x < 34 && position.z > -27 && position.z < 27);
      for (const interior of interiors) {
        local.copy(position).sub(new THREE.Vector3(...interior.position)).applyQuaternion(new THREE.Quaternion(...interior.quaternion).invert());
        assert.ok(Math.abs(local.x) > interior.halfExtents[0] || Math.abs(local.z) > interior.halfExtents[2], "no petals visible inside a shop, including through its cutaway");
      }
    }
  }
  runtime.dispose();
});

test("sakura is deterministic and frees its single draw-call resources exactly once", () => {
  const first = new THREE.Scene(), second = new THREE.Scene();
  const a = createSakuraPetals(first, KYOTO_ENVIRONMENT, false);
  const b = createSakuraPetals(second, KYOTO_ENVIRONMENT, false);
  const firstMesh = first.children[0] as THREE.InstancedMesh;
  const secondMesh = second.children[0] as THREE.InstancedMesh;
  for (let i = 0; i < 20; i++) { a.update(1 / 60, .5); b.update(1 / 60, .5); }
  assert.deepEqual(firstMesh.instanceMatrix.array, secondMesh.instanceMatrix.array);
  let geometriesDisposed = 0, materialsDisposed = 0, instancesDisposed = 0;
  firstMesh.geometry.addEventListener("dispose", () => geometriesDisposed++);
  (firstMesh.material as THREE.Material).addEventListener("dispose", () => materialsDisposed++);
  firstMesh.addEventListener("dispose", () => instancesDisposed++);
  a.dispose(); a.dispose(); a.update(1, 1); b.dispose();
  assert.equal(first.children.length, 0);
  assert.equal(geometriesDisposed, 1);
  assert.equal(materialsDisposed, 1);
  assert.equal(instancesDisposed, 1);
});

test("reduced motion and manifests without cherry trees allocate no animated layer", () => {
  const scene = new THREE.Scene();
  const reduced = createSakuraPetals(scene, KYOTO_ENVIRONMENT, true);
  const empty = createSakuraPetals(scene, { ...KYOTO_ENVIRONMENT, physics: undefined }, false);
  reduced.update(.1, 1); empty.update(.1, 0);
  assert.equal(scene.children.length, 0);
  reduced.dispose(); empty.dispose();
});
