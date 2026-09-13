import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createSkyEnvironment } from "../../lib/world/sky-environment";
import type { EnvironmentManifest } from "../../lib/world/schema";

const environment: EnvironmentManifest = {
  id: "kyoto", revision: "test", name: "Kyoto", assetUrl: null, spawn: [0, 0, 0],
  bounds: { min: [-34, -4, -27], max: [34, 24, 27] }, colliders: [], npcSpawns: {},
};

test("atmosphere preserves playable geometry and never writes sky depth", () => {
  const scene = new THREE.Scene(), atmosphere = createSkyEnvironment(scene, environment);
  const group = scene.getObjectByName("World atmosphere")!;
  const sky = group.getObjectByName("Procedural sky") as THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  assert.equal(sky.material.depthWrite, false);
  assert.equal(sky.material.depthTest, false);
  for (const object of group.children) {
    if (object === sky) continue;
    const mesh = object as THREE.Mesh;
    const positions = mesh.geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), z = positions.getZ(i), y = positions.getY(i) + mesh.position.y;
      if (Math.abs(x) <= 34 && Math.abs(z) <= 27) assert.ok(y < -4, `${mesh.name} enters the city bounds`);
    }
    assert.equal(mesh.castShadow, false);
  }
  atmosphere.dispose();
});

test("day/night updates reuse resources and dispose removes all backdrop geometry", () => {
  const scene = new THREE.Scene(), atmosphere = createSkyEnvironment(scene, environment);
  const group = scene.getObjectByName("World atmosphere")!;
  let geometryDisposals = 0, materialDisposals = 0;
  for (const object of group.children) {
    const mesh = object as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
    mesh.geometry.addEventListener("dispose", () => geometryDisposals++);
    mesh.material.addEventListener("dispose", () => materialDisposals++);
  }
  const count = group.children.length;
  const meadow = group.getObjectByName("Outer meadow") as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  const daylightColor = meadow.material.color.clone();
  atmosphere.update(0, 0, new THREE.Vector3(0, -1, 0), 10);
  assert.ok(meadow.material.color.r < daylightColor.r);
  atmosphere.update(12, 1, new THREE.Vector3(0, 1, 0), 20);
  assert.ok(meadow.material.color.equals(daylightColor));
  assert.equal(group.children.length, count);
  atmosphere.dispose();
  atmosphere.dispose();
  assert.equal(geometryDisposals, count);
  assert.equal(materialDisposals, count);
  assert.equal(scene.children.length, 0);
});
