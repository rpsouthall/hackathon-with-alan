import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Matrix3, Mesh, Quaternion, Raycaster, Vector3 } from "three";
import gameplay from "../../lib/world/data/kyoto-city-gameplay.json";

// Use exported triangles, not source dimensions: transforms and float precision
// in the actual runtime model exposed the stationary flicker in the user video.
const model = readFile(new URL("../../public/models/kyoto/kyoto_city_lod1.glb", import.meta.url)).then(async (bytes) => {
  const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  gltf.scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  gltf.scene.traverse((node) => { if (node instanceof Mesh && node.name.startsWith("SM_Venue_")) meshes.push(node); });
  return meshes;
});

function depthTies(meshes: Mesh[], origin: Vector3, direction: Vector3, far: number) {
  const ray = new Raycaster(origin, direction, 0, far);
  // Materials are double-sided. Buried bottom faces of posts legitimately meet
  // the floor, but do not compete with its upward-facing rendered surface.
  const hits = ray.intersectObjects(meshes, false).filter((hit) => hit.face &&
    hit.face.normal.clone().applyNormalMatrix(new Matrix3().getNormalMatrix(hit.object.matrixWorld)).dot(direction) < -0.00001);
  assert.ok(hits.length > 0, "Every probe must reach actual shop geometry");
  const conflicts = new Set<string>();
  for (let i = 0; i < hits.length; i++) for (let j = i + 1; j < hits.length; j++) {
    if (hits[j].distance - hits[i].distance > 0.00005) break;
    if (hits[i].object !== hits[j].object) conflicts.add(`${hits[i].object.name} / ${hits[j].object.name}`);
  }
  return [...conflicts];
}

test("actual venue side walls and timber posts do not share exterior depth", async () => {
  const meshes = await model;
  const failures: string[] = [];
  const walls = gameplay.colliders.filter((box) => /^SM_COL_.*_wall_(left|right)$/.test(box.name));
  assert.equal(walls.length, 16, "Both side walls of all eight venues are checked");
  for (const wall of walls) {
    const venue = wall.name.replace(/^SM_COL_/, "").replace(/_wall_(left|right)$/, "");
    const normal = new Vector3(wall.name.endsWith("_left") ? -1 : 1, 0, 0)
      .applyQuaternion(new Quaternion(...wall.quaternion)).normalize();
    const origin = new Vector3(...wall.position).addScaledVector(normal, 1);
    failures.push(...depthTies(meshes.filter((mesh) => mesh.name.startsWith(`SM_Venue_${venue}_`)), origin, normal.negate(), 2));
  }
  assert.deepEqual(failures, [], "Coplanar plaster/timber produces triangular flicker as the camera settles");
});

test("actual floorboards remain separated from the supporting floor in every shop", async () => {
  const meshes = await model;
  const failures = new Set<string>();
  const floors = gameplay.colliders.filter((box) => /^SM_COL_.*_floor$/.test(box.name));
  assert.equal(floors.length, 8);
  for (const floor of floors) {
    const venue = floor.name.replace(/^SM_COL_/, "").replace(/_floor$/, "");
    const surfaces = meshes.filter((mesh) => mesh.name.startsWith(`SM_Venue_${venue}_`));
    for (let board = 0; board < 24; board++) {
      const origin = new Vector3(-3.55 + (board + .5) * 7.1 / 24, 0, 0)
        .applyQuaternion(new Quaternion(...floor.quaternion)).add(new Vector3(...floor.position));
      origin.y = .45;
      for (const conflict of depthTies(surfaces, origin, new Vector3(0, -1, 0), .25)) failures.add(conflict);
    }
  }
  assert.deepEqual([...failures], [], "Floorboard tops must not coincide with the structural floor surface");
});

test("bakery display shelves and their uprights do not share front-face depth", async () => {
  const meshes = (await model).filter((mesh) => mesh.name.startsWith("SM_Venue_sakura_bakery_"));
  const shelf = gameplay.colliders.find((box) => box.name === "SM_COL_sakura_bakery_bakery_jars");
  assert.ok(shelf, "The bakery display fixture must exist");
  const rotation = new Quaternion(...shelf.quaternion);
  const direction = new Vector3(0, 0, -1).applyQuaternion(rotation).normalize();
  const failures = new Set<string>();
  const height = shelf.halfExtents[1] * 2;
  for (const side of [-1, 1]) for (let row = 0; row < 5; row++) {
    const origin = new Vector3(side * (shelf.halfExtents[0] - .045),
      .34 + row * (height - .12) / 4 - shelf.position[1], shelf.halfExtents[2] + 1)
      .applyQuaternion(rotation).add(new Vector3(...shelf.position));
    for (const conflict of depthTies(meshes, origin, direction, 1.5)) failures.add(conflict);
  }
  assert.deepEqual([...failures], [], "Display boards, posts and backing need distinct visible surfaces");
});
