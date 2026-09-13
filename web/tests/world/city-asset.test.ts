import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { Mesh, Vector3 } from "three";
import { KYOTO_ENVIRONMENT, KYOTO_NPCS } from "../../lib/world/kyoto";
import release from "../../public/models/kyoto/RELEASE.json";

test("city geometry, collision data, markers and complete cast belong to the same release", async () => {
  const asset = await readFile(new URL("../../public/models/kyoto/kyoto_city_lod1.glb", import.meta.url));
  const gameplay = await readFile(new URL("../../lib/world/data/kyoto-city-gameplay.json", import.meta.url));
  assert.equal(createHash("sha256").update(asset).digest("hex"), release.files["kyoto_city_lod1.glb"].sha256);
  assert.equal(createHash("sha256").update(gameplay).digest("hex"), release.files["kyoto_city_gameplay.json"].sha256);
  assert.equal(KYOTO_ENVIRONMENT.revision, release.revision);
  assert.equal(KYOTO_ENVIRONMENT.physics?.colliders.length, 294);
  assert.equal(KYOTO_ENVIRONMENT.lights?.length, 16);
  assert.deepEqual(KYOTO_NPCS.map(n => n.id).sort(), [...release.npc_ids].sort());
  const gltf = await new GLTFLoader().parseAsync(asset.buffer.slice(asset.byteOffset, asset.byteOffset + asset.byteLength), "");
  gltf.scene.updateMatrixWorld(true);
  let triangles = 0, vertexColors = false;
  const markers = new Map<string, Vector3>();
  gltf.scene.traverse((node) => {
    if (node.userData.npc_id) markers.set(node.userData.npc_id, node.getWorldPosition(new Vector3()));
    if (node instanceof Mesh) {
      triangles += (node.geometry.index?.count ?? node.geometry.attributes.position.count) / 3;
      vertexColors ||= Boolean(node.geometry.attributes.color);
    }
  });
  assert.equal(triangles, 303401);
  assert.ok(vertexColors, "preserve canopy vertex colours");
  for (const npc of KYOTO_NPCS) {
    assert.ok(markers.has(npc.id), `GLB includes ${npc.id}`);
    assert.ok(markers.get(npc.id)!.distanceTo(new Vector3(...npc.position)) < .0001, `matching world coordinates for ${npc.id}`);
  }
});
