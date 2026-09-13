import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { GameCameraRig } from "../../lib/world/camera-rig";
import { setOcclusionRay } from "../../lib/world/occlusion";

test("visibility rays follow the actual projection throughout camera transitions", () => {
  const feet = new THREE.Vector3(5, .3, 10);
  const rig = new GameCameraRig(feet, new THREE.Vector3());
  rig.resize(1280, 720);
  const ray = new THREE.Raycaster();
  try {
    for (const view of ["third-person", "isometric"] as const) {
      rig.setView(view);
      for (let frame = 0; frame <= 30; frame++) {
        if (frame) rig.update(.025, feet);
        const camera = rig.camera;
        camera.updateMatrixWorld(true);
        for (const x of [-3, -1.5, 0, 1.5, 3]) {
          for (const y of [-2, -1, 0, 1, 2]) {
            const target = rig.focus.clone().add(new THREE.Vector3(x, y, 0));
            const ndc = target.clone().project(camera);
            const near = new THREE.Vector3(ndc.x, ndc.y, -1).unproject(camera);
            const far = new THREE.Vector3(ndc.x, ndc.y, 1).unproject(camera);
            const expected = far.sub(near).normalize();
            setOcclusionRay(ray, camera, target);
            const context = `${view}, frame ${frame}, offset ${x},${y}`;
            assert.ok(ray.ray.direction.distanceTo(expected) < 1e-7, context);
            assert.ok(ray.ray.distanceToPoint(near) < 1e-7, context);
            assert.ok(ray.ray.distanceToPoint(target) < 1e-7, context);
            assert.ok(Math.abs(ray.ray.at(ray.far, new THREE.Vector3()).distanceTo(target) - .2) < 1e-7, context);
          }
        }
      }
    }
  } finally {
    rig.dispose();
  }
});
