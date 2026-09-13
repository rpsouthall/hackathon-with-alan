import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GameCameraRig, setTransitionProjection } from "../../lib/world/camera-rig";

const spawn = new THREE.Vector3(5, 0.3, 10);
const center = new THREE.Vector3();
function finish(rig: GameCameraRig, feet = spawn) { for (let i = 0; i < 60; i++) rig.update(1 / 60, feet); }
function project(rig: GameCameraRig, point: THREE.Vector3) { rig.camera.updateMatrixWorld(); return point.clone().project(rig.camera); }
function assertNear(a: number, b: number, tolerance = 1e-5) { assert(Math.abs(a - b) < tolerance, `${a} differs from ${b}`); }

test("view changes keep the same first frame, end in a true perspective camera and restore isometric framing", () => {
  const rig = new GameCameraRig(spawn, center); rig.resize(1280, 720);
  const point = spawn.clone().add(new THREE.Vector3(0.5, 1.4, 0.7));
  const before = project(rig, point);
  rig.setView("third-person", 0.4);
  assert(project(rig, point).distanceTo(before) < 1e-6);
  for (let i = 0; i < 44; i++) rig.update(1 / 60, spawn);
  const penultimate = project(rig, point);
  rig.update(1 / 60, spawn); rig.update(1e-8, spawn);
  assert.equal(rig.isTransitioning, false);
  assert.equal(rig.camera, rig.perspective);
  assert(project(rig, point).distanceTo(penultimate) < 0.01, "No endpoint projection pop");
  assertNear(rig.thirdControls.getDistance(), 6.5);
  rig.setView("isometric"); finish(rig);
  assert.equal(rig.camera, rig.orthographic);
  assert(project(rig, point).distanceTo(before) < 1e-5);
  assertNear(rig.isoControls.getPolarAngle(), Math.acos(1 / Math.sqrt(3)));
  assert.deepEqual(spawn.toArray(), [5, 0.3, 10]); rig.dispose();
});

test("hybrid projection preserves focal-plane scale and valid near/far depth throughout the transition", () => {
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 250);
  for (const perspective of [0, 0.1, 0.5, 0.9, 1]) {
    setTransitionProjection(camera, { radius: 10, phi: 1, theta: 0, halfHeight: 4, perspective }, 2);
    const point = new THREE.Vector3(2, 2, -10).applyMatrix4(camera.projectionMatrix);
    assertNear(point.x, 0.25); assertNear(point.y, 0.5);
    assertNear(new THREE.Vector3(0, 0, -camera.near).applyMatrix4(camera.projectionMatrix).z, -1);
    assertNear(new THREE.Vector3(0, 0, -camera.far).applyMatrix4(camera.projectionMatrix).z, 1);
    const identity = camera.projectionMatrix.clone().multiply(camera.projectionMatrixInverse);
    identity.elements.forEach((value, i) => assertNear(value, i % 5 === 0 ? 1 : 0));
  }
});

test("third person orbits through 360 degrees and allows pitch while isometric keeps a fixed elevation", () => {
  const rig = new GameCameraRig(spawn, center); rig.setView("third-person"); finish(rig);
  rig.thirdControls.enableDamping = false;
  const start = rig.camera.position.clone();
  const quadrants = new Set<string>();
  for (let i = 0; i < 4; i++) {
    rig.thirdControls.rotateLeft(Math.PI / 2); rig.update(1 / 60, spawn);
    const offset = rig.camera.position.clone().sub(rig.focus);
    quadrants.add(`${Math.round(offset.x)},${Math.round(offset.z)}`);
  }
  assert.equal(quadrants.size, 4); assert(rig.camera.position.distanceTo(start) < 1e-5);
  const pitch = rig.thirdControls.getPolarAngle();
  rig.thirdControls.rotateUp(0.25); rig.update(1 / 60, spawn);
  assert(rig.thirdControls.getPolarAngle() < pitch - 0.2);
  rig.setView("isometric"); finish(rig);
  rig.isoControls.rotateUp(0.5); rig.update(1 / 60, spawn);
  assertNear(rig.isoControls.getPolarAngle(), Math.acos(1 / Math.sqrt(3))); rig.dispose();
});

test("overview returns to the chosen third-person view, including its orbit and zoom, following the current player", () => {
  const rig = new GameCameraRig(spawn, center); rig.setView("third-person"); finish(rig);
  rig.thirdControls.enableDamping = false;
  rig.thirdControls.rotateLeft(0.9); rig.thirdControls.dollyIn(0.8); rig.update(1 / 60, spawn);
  const angle = rig.thirdControls.getAzimuthalAngle(), distance = rig.thirdControls.getDistance();
  rig.setOverview(true); finish(rig);
  assert.equal(rig.camera, rig.orthographic); assert.equal(rig.view, "third-person");
  assert(rig.focus.distanceTo(center) < 1e-6);
  const moved = spawn.clone().add(new THREE.Vector3(4, 0, -3));
  rig.setOverview(false); finish(rig, moved);
  assert.equal(rig.camera, rig.perspective);
  assert(rig.focus.distanceTo(moved.clone().add(new THREE.Vector3(0, 1, 0))) < 1e-5);
  assertNear(rig.thirdControls.getAzimuthalAngle(), angle);
  assertNear(rig.thirdControls.getDistance(), distance); rig.dispose();
});

test("rapid reversals and resizing during a transition remain finite and centered", () => {
  const rig = new GameCameraRig(spawn, center);
  for (let i = 0; i < 8; i++) {
    rig.setView(i % 2 ? "isometric" : "third-person"); rig.update(0.08, spawn);
    rig.resize(i % 2 ? 390 : 1600, i % 2 ? 844 : 900);
    const projected = project(rig, rig.focus);
    assertNear(projected.x, 0); assertNear(projected.y, 0);
    assert(rig.camera.projectionMatrix.elements.every(Number.isFinite));
    assert(rig.camera.position.toArray().every(Number.isFinite));
  }
  finish(rig); assert.equal(rig.camera, rig.orthographic); rig.dispose();
});

test("reduced motion changes immediately and dialogs disable both sets of camera controls", () => {
  const rig = new GameCameraRig(spawn, center, undefined, true);
  rig.setInputEnabled(false); rig.setView("third-person"); rig.update(0, spawn);
  assert.equal(rig.isTransitioning, false); assert.equal(rig.camera, rig.perspective);
  assert.equal(rig.isoControls.enabled, false); assert.equal(rig.thirdControls.enabled, false);
  rig.setInputEnabled(true); assert.equal(rig.thirdControls.enabled, true); assert.equal(rig.isoControls.enabled, false);
  rig.update(NaN, spawn); assert(rig.camera.position.toArray().every(Number.isFinite)); rig.dispose();
});

 test("encounter frames the NPC left of the panel and restores the exploration shot", () => {
  const rig = new GameCameraRig(spawn, center); rig.resize(1440, 900);
  const before = project(rig, spawn.clone().add(new THREE.Vector3(0, 1, 0)));
  const npc = new THREE.Vector3(6, .3, 11);
  rig.setEncounter(npc, .4); finish(rig);
  assert.equal(rig.shot, "encounter");
  const head = project(rig, npc.clone().add(new THREE.Vector3(0, 1.5, 0)));
  assert(head.x < -.1 && head.x > -.8, "NPC stays in the open left side");
  assert.equal(rig.thirdControls.enabled, false);
  rig.setEncounter(null); finish(rig);
  assert.equal(rig.shot, "isometric");
  assert(project(rig, spawn.clone().add(new THREE.Vector3(0, 1, 0))).distanceTo(before) < 1e-5);
  assert.equal(rig.isoControls.enabled, true);
  rig.dispose();
});

test("portrait encounter keeps the NPC above the bottom sheet", () => {
  const rig = new GameCameraRig(spawn, center); rig.resize(390, 844);
  rig.setEncounter(spawn, 0); finish(rig);
  const head = project(rig, spawn.clone().add(new THREE.Vector3(0, 1.5, 0)));
  assert(Math.abs(head.x) < .01);
  assert(head.y > .4 && head.y < 1, "NPC head remains above the sheet at 30vh");
  rig.dispose();
});
