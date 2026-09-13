import RAPIER from '@dimforge/rapier3d-compat';
import { initWorldPhysics } from './physics';
import type { EnvironmentManifest, NpcSnapshot, Vec3 } from './schema';

const CELL = 0.4, CLEARANCE = 0.34;
/** Read-only planning against the exported colliders. Movement remains room-authoritative. */
export async function createWalkingMap(environment: EnvironmentManifest) {
  await initWorldPhysics();
  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  try {
    for (const box of environment.physics?.colliders ?? []) {
      const [x, y, z, w] = box.quaternion;
      world.createCollider(RAPIER.ColliderDesc.cuboid(...box.halfExtents).setTranslation(...box.position).setRotation({ x, y, z, w }));
    }
    for (const box of environment.colliders) world.createCollider(RAPIER.ColliderDesc.cuboid(
      (box.max[0] - box.min[0]) / 2, (box.max[1] - box.min[1]) / 2, (box.max[2] - box.min[2]) / 2,
    ).setTranslation(...box.min.map((v, i) => (v + box.max[i]) / 2) as Vec3));
    world.step();
    const { min, max } = environment.bounds;
    const width = Math.floor((max[0] - min[0]) / CELL) + 1, depth = Math.floor((max[2] - min[2]) / CELL) + 1;
    const heights = new Float32Array(width * depth).fill(NaN);
    const shape = new RAPIER.Capsule((1.65 - 2 * CLEARANCE) / 2, CLEARANCE);
    for (let iz = 1; iz < depth - 1; iz++) {
      for (let ix = 1; ix < width - 1; ix++) {
        const x = min[0] + ix * CELL, z = min[2] + iz * CELL;
        // City walks and bridge ramps are within two metres of the spawn level.
        // Higher roofs are intentionally excluded from pedestrian navigation.
        const rayY = environment.spawn[1] + 2;
        const hit = world.castRay(new RAPIER.Ray({ x, y: rayY, z }, { x: 0, y: -1, z: 0 }), 4, true);
        if (environment.physics && !hit) continue;
        const y = hit ? rayY - hit.timeOfImpact : environment.spawn[1];
        let blocked = false;
        world.intersectionsWithShape({ x, y: y + 0.87, z }, { x: 0, y: 0, z: 0, w: 1 }, shape, () => { blocked = true; return false; });
        if (!blocked) heights[iz * width + ix] = y;
      }
      if (iz % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    const point = (key: number): Vec3 => [min[0] + (key % width) * CELL, heights[key], min[2] + Math.floor(key / width) * CELL];
    const valid = (key: number) => key >= 0 && key < heights.length && Number.isFinite(heights[key]);
    return {
      route(start: Vec3, npc: Pick<NpcSnapshot, 'position' | 'interactionRadius'>, canStop: (position: Vec3) => boolean = () => true): Vec3[] | null {
        let first = -1, nearest = 1;
        for (let key = 0; key < heights.length; key++) if (valid(key)) {
          const p = point(key), d = Math.hypot(p[0] - start[0], p[1] - start[1], p[2] - start[2]);
          if (d < nearest) { first = key; nearest = d; }
        }
        if (first < 0) return null;
        const goalDistance = (key: number) => { const p = point(key); return Math.hypot(p[0] - npc.position[0], p[1] - npc.position[1], p[2] - npc.position[2]); };
        const radius = Math.max(0.5, npc.interactionRadius - 0.5);
        const open = new Set([first]), closed = new Set<number>(), parent = new Map<number, number>();
        const cost = new Map([[first, 0]]), score = new Map([[first, goalDistance(first)]]);
        while (open.size) {
          let current = -1, best = Infinity;
          for (const key of open) if (score.get(key)! < best) { current = key; best = score.get(key)!; }
          if (goalDistance(current) <= radius && canStop(point(current))) {
            const result: Vec3[] = [];
            for (let key: number | undefined = current; key !== undefined; key = parent.get(key)) result.push(point(key));
            return result.reverse();
          }
          open.delete(current); closed.add(current);
          for (const dx of [-1, 0, 1]) for (const dz of [-1, 0, 1]) {
            if (!dx && !dz) continue;
            const next = current + dz * width + dx;
            if (!valid(next) || closed.has(next) || Math.abs(next % width - current % width) > 1) continue;
            // Prevent diagonal corner cutting, including tight doorways.
            if (dx && dz && (!valid(current + dx) || !valid(current + dz * width))) continue;
            if (Math.abs(heights[next] - heights[current]) > 0.27) continue;
            const candidate = cost.get(current)! + CELL * Math.hypot(dx, dz);
            if (candidate >= (cost.get(next) ?? Infinity)) continue;
            cost.set(next, candidate); score.set(next, candidate + Math.max(0, goalDistance(next) - radius)); parent.set(next, current); open.add(next);
          }
        }
        return null;
      },
    };
  } finally { world.free(); }
}
