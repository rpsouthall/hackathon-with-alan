import * as THREE from "three";
import { EMOTES } from "../world/player-actions";

/** Extra gestures over the exported rig; copied idle tracks keep the feet and accessories grounded. */
export function createExtraEmoteClips(idle: THREE.AnimationClip): THREE.AnimationClip[] {
  const make = (name: string, duration: number, rotations: Record<string, [number[], [number, number, number][]]>) => {
    const clip = idle.clone(); clip.name = name;
    clip.tracks.forEach((track) => track.scale(duration / idle.duration));
    for (const [bone, [times, poses]] of Object.entries(rotations)) {
      const trackName = `${bone}.quaternion`;
      clip.tracks = clip.tracks.filter((track) => track.name !== trackName);
      const values = poses.flatMap(([x, y, z]) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray());
      clip.tracks.push(new THREE.QuaternionKeyframeTrack(trackName, times, values));
    }
    clip.duration = duration;
    return clip;
  };
  const cheerTimes = [0, 0.35, 0.65, 0.95, 1.25, 1.55, 1.9, 2.4];
  const lift = [0, 2.65, 3.0, 2.65, 3.0, 2.65, 2.65, 0];
  const cheer = make("Cheer", EMOTES.cheer.duration, {
    L_upperArm: [cheerTimes, lift.map((z) => [-0.035 * z, 0, z])],
    R_upperArm: [cheerTimes, lift.map((z) => [-0.035 * z, 0, -z])],
    L_forearm: [cheerTimes, lift.map((z) => [-0.03 * z, 0, 0])],
    R_forearm: [cheerTimes, lift.map((z) => [-0.03 * z, 0, 0])],
    head: [[0, 0.4, 1.8, 2.4], [[0, 0, 0], [-0.12, 0, 0], [-0.12, 0, 0], [0, 0, 0]]],
  });
  const nod = make("Nod", EMOTES.nod.duration, {
    head: [[0, 0.24, 0.5, 0.76, 1.02, 1.3, 1.6], [[0, 0, 0], [0.3, 0, 0], [0, 0, 0], [0.3, 0, 0], [0, 0, 0], [0.18, 0, 0], [0, 0, 0]]],
  });
  return [cheer, nod];
}
