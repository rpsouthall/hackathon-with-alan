import { after, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createAvatar, disposeAvatarTemplate } from "../../lib/characters/avatar";
import { updateSpeakingAnimation } from "../../lib/characters/speaking-animation";

const bytes = await readFile(new URL("../../public/models/characters/komorebi_npc.glb", import.meta.url));
const template = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
after(() => disposeAvatarTemplate(template));
const stationary = { moving: false, emoting: false, listening: false };

test("actual Talk clip advances across repeated speaking frames and stops with speech", () => {
  const avatar = createAvatar(template);
  try {
    const idleHand = avatar.getSocket("socket_hand_R");
    for (let frame = 0; frame < 30; frame++) {
      updateSpeakingAnimation(avatar, true, stationary);
      avatar.update(1 / 60);
    }
    assert.equal(avatar.current, "Talk");
    assert(Math.abs(avatar.actions.Talk.time - .5) < 1e-6, "Activity updates do not restart Talk");
    assert(avatar.actions.Talk.isRunning());
    assert(idleHand.distanceTo(avatar.getSocket("socket_hand_R")) > .01, "The authored talking gesture moves the skeleton");
    updateSpeakingAnimation(avatar, false, stationary);
    assert.equal(avatar.current, "Idle");
    for (let frame = 0; frame < 20; frame++) avatar.update(1 / 60);
    assert.equal(avatar.actions.Talk.getEffectiveWeight(), 0);
    const idleTime = avatar.actions.Idle.time;
    updateSpeakingAnimation(avatar, false, stationary);
    avatar.update(.05);
    assert(avatar.actions.Idle.time > idleTime, "Silence does not restart Idle");
  } finally { avatar.dispose(); }
});

test("NPCs return to Listen after speech and Idle when the encounter ends", () => {
  const avatar = createAvatar(template);
  try {
    const encounter = { ...stationary, listening: true };
    updateSpeakingAnimation(avatar, false, encounter);
    assert.equal(avatar.current, "Listen");
    updateSpeakingAnimation(avatar, true, encounter);
    avatar.update(.1);
    assert.equal(avatar.current, "Talk");
    updateSpeakingAnimation(avatar, false, encounter);
    assert.equal(avatar.current, "Listen");
    updateSpeakingAnimation(avatar, false, stationary);
    assert.equal(avatar.current, "Idle");
  } finally { avatar.dispose(); }
});

test("speech preserves walking, running, and one-shot gestures", () => {
  const avatar = createAvatar(template);
  try {
    for (const gait of ["walk", "run"] as const) {
      updateSpeakingAnimation(avatar, true, stationary);
      avatar.setVelocity(new THREE.Vector3(3, 0, 0), gait);
      for (const speaking of [true, false]) {
        updateSpeakingAnimation(avatar, speaking, { ...stationary, moving: true });
        avatar.update(.1);
        assert.equal(avatar.current, gait === "walk" ? "Walk" : "Run");
      }
      avatar.setVelocity(new THREE.Vector3());
      updateSpeakingAnimation(avatar, true, stationary);
      assert.equal(avatar.current, "Talk");
    }
    avatar.playEmote("wave");
    for (let frame = 0; frame < 24; frame++) {
      updateSpeakingAnimation(avatar, frame % 2 === 0, { ...stationary, emoting: true });
      avatar.update(1 / 60);
    }
    assert.equal(avatar.current, "Wave");
    assert(avatar.actions.Wave.time > .2, "Voice activity does not restart the gesture");
    updateSpeakingAnimation(avatar, true, stationary);
    assert.equal(avatar.current, "Wave", "An active gesture remains protected if its external marker has already expired");
    for (let frame = 0; frame < 180; frame++) avatar.update(1 / 60);
    updateSpeakingAnimation(avatar, true, stationary);
    assert.equal(avatar.current, "Talk", "Speech resumes after the gesture finishes");
  } finally { avatar.dispose(); }
});

test("voice activity preserves scooter grips and the riding animation layer", () => {
  const avatar = createAvatar(template);
  try {
    updateSpeakingAnimation(avatar, true, stationary);
    avatar.setRiding({ kind: "scooter", speed: 4 });
    for (let frame = 0; frame < 30; frame++) {
      updateSpeakingAnimation(avatar, frame < 15, stationary);
      avatar.update(1 / 60);
    }
    assert.equal(avatar.current, "Idle");
    assert.equal(avatar.riding, "scooter");
    for (const [side, x] of [["L", .28], ["R", -.28]] as const) {
      assert(avatar.getSocket(`socket_hand_${side}`).distanceTo(new THREE.Vector3(x, 1.12, .5)) < .025);
    }
    avatar.setRiding(null);
    updateSpeakingAnimation(avatar, false, stationary);
    assert.equal(avatar.current, "Idle");
    updateSpeakingAnimation(avatar, true, stationary);
    assert.equal(avatar.current, "Talk");
  } finally { avatar.dispose(); }
});
