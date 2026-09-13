import type { EnvironmentManifest, NpcSnapshot, Vec3, WorldVenue } from './schema';

export const venueForNpc = (environment: EnvironmentManifest, npcId: string) => environment.venues?.find(venue => venue.npcId === npcId);

/** The player's feet must be within the shop, beyond its doorway. */
export function isInsideVenue(venue: WorldVenue, position: Vec3) {
  return position.every((value, axis) => value >= venue.bounds.min[axis] && value <= venue.bounds.max[axis]);
}

export function canTalkToNpc(environment: EnvironmentManifest, npc: NpcSnapshot, position: Vec3) {
  const venue = venueForNpc(environment, npc.id);
  return (!venue || isInsideVenue(venue, position)) && Math.hypot(...position.map((value, axis) => value - npc.position[axis])) <= npc.interactionRadius;
}
