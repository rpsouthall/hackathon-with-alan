import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { DayCycle, DAY_LENGTH_SECONDS, INITIAL_HOUR, daylightAtHour, formatWorldTime } from "../../lib/world/day-cycle";
import { addWorldLighting } from "../../lib/world/lighting";
import { KYOTO_ENVIRONMENT } from "../../lib/world/kyoto";

test("day/night cycle completes twelve minutes without a midnight discontinuity", () => {
  const clock = new DayCycle();
  clock.update(DAY_LENGTH_SECONDS);
  assert.ok(Math.abs(clock.hours - INITIAL_HOUR) < 1e-8);
  const split = new DayCycle();
  for (let i = 0; i < 120; i++) split.update(1 / 60);
  clock.update(2);
  assert.ok(Math.abs(split.hours - clock.hours) < 1e-8);
  assert.ok(Math.abs(daylightAtHour(23.999) - daylightAtHour(.001)) < .001);
  assert.equal(daylightAtHour(12), 1);
  assert.equal(daylightAtHour(0), 0);
  assert.equal(formatWorldTime(24), "00:00");
});

test("manual presets ease through the shortest arc, pause, and resume", () => {
  const clock = new DayCycle();
  clock.setHour(23); clock.update(3);
  clock.setHour(1); clock.update(1.2);
  assert.ok(clock.hours < .001 || clock.hours > 23.999);
  clock.update(1.2);
  assert.equal(clock.hours, 1);
  assert.equal(clock.playing, false);
  clock.update(100); assert.equal(clock.hours, 1);
  clock.setPlaying(true); clock.update(30); assert.equal(clock.hours, 2);
  clock.setHour(NaN); clock.update(NaN); assert.equal(clock.hours, 2);
});

test("reduced motion starts still and applies chosen times immediately", () => {
  const clock = new DayCycle(true);
  clock.update(100); assert.equal(clock.hours, INITIAL_HOUR);
  clock.setHour(22); assert.equal(clock.hours, 22);
  assert.equal(clock.playing, false);
});

test("scrubbing applies each requested time immediately without restarting a preset tween", () => {
  const clock = new DayCycle();
  clock.setHour(22); clock.update(.2);
  clock.setHour(6.25, false); assert.equal(clock.hours, 6.25);
  clock.setHour(6.5, false); assert.equal(clock.hours, 6.5);
  clock.update(1); assert.equal(clock.hours, 6.5);
  assert.equal(clock.playing, false);
});

test("moving sun retains city shadow coverage, night visibility and warmer practical lights", () => {
  const scene = new THREE.Scene();
  const renderer = { capabilities: { maxTextureSize: 4096 }, shadowMap: {} } as THREE.WebGLRenderer;
  const lighting = addWorldLighting(scene, renderer, KYOTO_ENVIRONMENT);
  const sun = scene.children.find(object => object instanceof THREE.DirectionalLight && object.castShadow) as THREE.DirectionalLight;
  const practical = scene.children.find(object => object instanceof THREE.PointLight) as THREE.PointLight;
  const hemisphere = scene.children.find(object => object instanceof THREE.HemisphereLight) as THREE.HemisphereLight;
  let dayIntensity = 0;
  for (const hours of [6, 9, 12, 18, 22]) {
    const angle = (hours - 6) * Math.PI / 12;
    const direction = new THREE.Vector3(-Math.cos(angle), Math.sin(angle), .32).normalize();
    lighting.update(hours, daylightAtHour(hours), direction);
    sun.shadow.camera.position.copy(sun.position);
    sun.shadow.camera.lookAt(sun.target.position);
    sun.shadow.camera.updateMatrixWorld(true);
    for (const x of [-34, 34]) for (const y of [-4, 24]) for (const z of [-27, 27]) {
      const point = new THREE.Vector3(x, y, z).project(sun.shadow.camera);
      assert.ok(Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1, `city corner clipped at ${hours}`);
    }
    if (hours === 12) dayIntensity = practical.intensity;
    if (hours === 22) { assert.ok(practical.intensity > dayIntensity * 2); assert.ok(hemisphere.intensity >= .5); assert.equal(sun.intensity, 0); }
  }
  lighting.dispose(); assert.equal(scene.children.length, 0);
});
