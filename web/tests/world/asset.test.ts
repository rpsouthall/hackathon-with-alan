import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Box3, Vector3 } from "three";

test("the GLB fixture loads through the real Three.js loader at meter scale", async () => {
  const file = await readFile(new URL("../../public/world-fixtures/courtyard.glb", import.meta.url));
  const buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  const bounds = new Box3().setFromObject(gltf.scene);
  const size = bounds.getSize(new Vector3());
  assert.equal(size.x, 24); assert.equal(size.z, 24);
  assert.ok(Math.abs(bounds.max.y) < 0.00001, "walk surface is y=0");
});
