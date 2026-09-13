import * as THREE from "three";
import type { EnvironmentManifest } from "./schema";
import { DayCycle, daylightAtHour, type WorldTime } from "./day-cycle";
import { addWorldLighting } from "./lighting";
import { createSkyEnvironment } from "./sky-environment";
import { createSakuraPetals } from "./sakura-petals";

export function createWorldAtmosphere(scene: THREE.Scene, renderer: THREE.WebGLRenderer, environment: EnvironmentManifest, reducedMotion: boolean, onTime?: (time: WorldTime) => void) {
  const clock = new DayCycle(reducedMotion);
  const lights = addWorldLighting(scene, renderer, environment);
  const sky = createSkyEnvironment(scene, environment);
  const petals = createSakuraPetals(scene, environment, reducedMotion);
  const sunDirection = new THREE.Vector3();
  let elapsed = 0, lastNotice = -Infinity;
  function update(dt: number) {
    clock.update(dt);
    elapsed += dt;
    const angle = (clock.hours - 6) * Math.PI / 12;
    sunDirection.set(-Math.cos(angle), Math.sin(angle), .32).normalize();
    const daylight = daylightAtHour(clock.hours);
    lights.update(clock.hours, daylight, sunDirection);
    sky.update(clock.hours, daylight, sunDirection, reducedMotion ? 0 : elapsed);
    petals.update(dt, daylight);
    if (elapsed - lastNotice >= .5) { onTime?.({ hours: clock.hours, playing: clock.playing }); lastNotice = elapsed; }
  }
  update(0);
  return {
    update,
    setHour(hours: number, animate = true) { clock.setHour(hours, animate); lastNotice = -Infinity; update(0); },
    setPlaying(playing: boolean) { clock.setPlaying(playing); lastNotice = -Infinity; update(0); },
    dispose() { petals.dispose(); sky.dispose(); lights.dispose(); },
  };
}
