import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { ANIMATIONS, CHARACTER_PRESETS, createAvatar, disposeAvatarTemplate, type CharacterAvatar } from "../../lib/characters/avatar";

const data = await readFile(new URL("../../public/models/characters/komorebi_npc.glb", import.meta.url));
const template = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
after(() => disposeAvatarTemplate(template));

function updateSkeletons(object: THREE.Object3D): void {
  object.updateMatrixWorld(true);
  object.traverse((node) => { if (node instanceof THREE.SkinnedMesh) node.skeleton.update(); });
}

function visibleBounds(object: THREE.Object3D): THREE.Box3 {
  updateSkeletons(object);
  const result = new THREE.Box3();
  const point = new THREE.Vector3();
  object.traverseVisible((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    for (let index = 0; index < node.geometry.attributes.position.count; index++) {
      node.getVertexPosition(index, point);
      result.expandByPoint(point.applyMatrix4(node.matrixWorld));
    }
  });
  return result;
}

function footBounds(avatar: CharacterAvatar, side: "L" | "R"): THREE.Box3 {
  updateSkeletons(avatar.object);
  const result = new THREE.Box3();
  const point = new THREE.Vector3();
  avatar.model.getObjectByName("SM_NPC_Body")!.traverse((node) => {
    if (!(node instanceof THREE.SkinnedMesh)) return;
    const indices = node.geometry.attributes.skinIndex;
    for (let index = 0; index < indices.count; index++) {
      if (node.skeleton.bones[indices.getX(index)].name !== `${side}_foot`) continue;
      node.getVertexPosition(index, point);
      result.expandByPoint(point.applyMatrix4(node.matrixWorld));
    }
  });
  return result;
}

test("actual character GLB loads seven usable clips and every cast preset stands at its requested height", () => {
  assert.equal(Object.keys(CHARACTER_PRESETS).length, 15);
  assert.deepEqual(template.animations.map((clip) => clip.name.replace(/^AN_NPC_/, "")).sort(), [...ANIMATIONS].sort());
  for (const clip of template.animations) {
    assert(clip.validate());
    assert(clip.duration > 0);
  }
  for (const preset of Object.values(CHARACTER_PRESETS)) {
    const avatar = createAvatar(template, preset.appearance);
    avatar.blinkEnabled = false;
    avatar.update(0);
    const bounds = visibleBounds(avatar.object);
    assert(Math.abs(bounds.max.y - preset.appearance.height) < 0.015, `${preset.name}: top at ${bounds.max.y}`);
    assert(Math.abs(bounds.min.y) < 0.005, `${preset.name}: feet at ${bounds.min.y}`);
    for (const name of ["socket_voice", "socket_head", "socket_hand_L", "socket_hand_R"]) assert(avatar.getSocket(name).toArray().every(Number.isFinite));
    avatar.object.position.set(4, 0.5, 2);
    assert(avatar.getSocket().y > 0.5);
    avatar.dispose();
  }
});

test("all fifteen city residents preserve independent appearances over the same GLB template", () => {
  const presets = Object.values(CHARACTER_PRESETS);
  assert.equal(new Set(presets.map((preset) => preset.id)).size, 15);
  assert.equal(new Set(presets.map((preset) => JSON.stringify(preset.appearance))).size, 15);
  const avatars = presets.map((preset) => createAvatar(template, preset.appearance));
  avatars[0].setAppearance({ skin: "#112233", top: "#abcdef", hair: "bob" });
  for (let index = 1; index < avatars.length; index++) {
    assert.deepEqual(avatars[index].appearance, presets[index].appearance);
    const material = [...avatars[index].materials].find((material) => material.name === "MAT_NPC_Top") as THREE.MeshStandardMaterial;
    assert.equal(material.color.getHexString(), presets[index].appearance.top.slice(1));
  }
  assert.notEqual(CHARACTER_PRESETS.local_guide.appearance.top, "#abcdef");
  for (const avatar of avatars) avatar.dispose();
});

test("avatar appearance, skeleton, facial morphs and animations are isolated between template clones", () => {
  const first = createAvatar(template, CHARACTER_PRESETS.inn_host.appearance);
  const second = createAvatar(template, CHARACTER_PRESETS.cafe_owner.appearance);
  first.setAppearance({ top: "#ab3456" });
  for (const avatar of [first, second]) {
    for (const slot of ["hair", "outfit"] as const) {
      const options: string[] = [];
      avatar.model.traverseVisible((node) => { if (node.userData.npc_part === slot) options.push(node.userData.npc_option); });
      assert.deepEqual(options, [avatar.appearance[slot]]);
    }
  }
  const firstTop = [...first.materials].find((material) => material.name === "MAT_NPC_Top") as THREE.MeshStandardMaterial;
  const secondTop = [...second.materials].find((material) => material.name === "MAT_NPC_Top") as THREE.MeshStandardMaterial;
  assert.notEqual(firstTop, secondTop);
  assert.equal(firstTop.color.getHexString(), "ab3456");
  assert.equal(secondTop.color.getHexString(), "bf7865");
  assert.notEqual(first.model.getObjectByName("L_shin"), second.model.getObjectByName("L_shin"));
  first.play("Walk", { fade: 0 });
  first.update(0.1);
  assert.notDeepEqual(first.model.getObjectByName("L_shin")!.quaternion.toArray(), second.model.getObjectByName("L_shin")!.quaternion.toArray());
  const firstMouth = first.model.getObjectByName("SM_NPC_Mouth") as THREE.Mesh;
  const secondMouth = second.model.getObjectByName("SM_NPC_Mouth") as THREE.Mesh;
  first.setSpeechLevel(2);
  first.update(0);
  assert.equal(firstMouth.morphTargetInfluences![firstMouth.morphTargetDictionary!.MouthOpen], 1);
  assert.equal(secondMouth.morphTargetInfluences![secondMouth.morphTargetDictionary!.MouthOpen], 0);
  first.setSpeechLevel(NaN);
  first.update(0);
  assert.equal(firstMouth.morphTargetInfluences![firstMouth.morphTargetDictionary!.MouthOpen], 0);
  assert.throws(() => first.setAppearance({ height: NaN }));
  assert.throws(() => first.setAppearance({ top: "javascript:bad" }));
  const before = first.appearance.height;
  assert.throws(() => first.setAppearance({ height: 999 }));
  assert.equal(first.appearance.height, before);
  first.dispose();
  first.dispose();
  second.update(0.1);
  assert(second.getSocket().toArray().every(Number.isFinite));
  second.dispose();
});

test("character locomotion keeps the ground contact and does not move authoritative actor positions", () => {
  for (const animation of ["Walk", "Run"] as const) {
    const avatar = createAvatar(template);
    avatar.play(animation, { fade: 0 });
    avatar.blinkEnabled = false;
    const duration = avatar.actions[animation].getClip().duration;
    for (let sample = 0; sample < 60; sample++) {
      avatar.mixer.setTime(sample / 60 * duration);
      const feet = [footBounds(avatar, "L"), footBounds(avatar, "R")];
      const minimum = Math.min(...feet.map((box) => box.min.y));
      assert(minimum > -0.012, `${animation} frame ${sample}: ground penetration ${minimum}`);
      assert(Math.abs(minimum) < 0.018, `${animation} frame ${sample}: missing stance foot ${minimum}`);
    }
    assert.deepEqual(avatar.object.position.toArray(), [0, 0, 0]);
    avatar.dispose();
  }
});

test("one-shot gestures finish normally, but an interrupted gesture cannot cancel locomotion", () => {
  const avatar = createAvatar(template);
  avatar.play("Bow", { fade: 0, once: true });
  for (let sample = 0; sample < 180; sample++) avatar.update(1 / 60);
  assert.equal(avatar.current, "Idle");
  avatar.play("Bow", { fade: 0, once: true });
  avatar.mixer.setTime(avatar.actions.Bow.getClip().duration - 0.06);
  avatar.play("Run", { fade: 0.18 });
  avatar.update(0.09);
  assert.equal(avatar.current, "Run");
  avatar.setVelocity(new THREE.Vector3(1, 0, 0));
  assert.equal(avatar.current, "Walk");
  avatar.setVelocity(new THREE.Vector3(3, 0, 0));
  assert.equal(avatar.current, "Run");
  avatar.setVelocity(new THREE.Vector3());
  assert.equal(avatar.current, "Idle");
  avatar.play("Listen");
  avatar.setVelocity(new THREE.Vector3());
  assert.equal(avatar.current, "Listen");
  avatar.dispose();
});

test("disposing an avatar only releases its own resources and template cleanup is idempotent", async () => {
  const asset = await new GLTFLoader().parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), "");
  const first = createAvatar(asset);
  const second = createAvatar(asset);
  let geometryDisposals = 0;
  let firstMaterialDisposals = 0;
  let secondMaterialDisposals = 0;
  const geometries = new Set<THREE.BufferGeometry>();
  asset.scene.traverse((node) => { if (node instanceof THREE.Mesh) geometries.add(node.geometry); });
  for (const geometry of geometries) geometry.addEventListener("dispose", () => geometryDisposals++);
  for (const material of first.materials) material.addEventListener("dispose", () => firstMaterialDisposals++);
  for (const material of second.materials) material.addEventListener("dispose", () => secondMaterialDisposals++);
  first.dispose();
  assert.equal(firstMaterialDisposals, first.materials.size);
  assert.equal(secondMaterialDisposals, 0);
  assert.equal(geometryDisposals, 0);
  second.dispose();
  disposeAvatarTemplate(asset);
  disposeAvatarTemplate(asset);
  assert.equal(geometryDisposals, geometries.size);
});
