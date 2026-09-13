import gameplay from "./data/kyoto-city-gameplay.json";
import { CHARACTER_PRESETS } from "../characters/presets";
import { environmentSchema, npcSchema } from "./schema";

// The asset release and its exported physics/markers always travel together.
const markers = gameplay.markers;
const spawn = markers.find((marker) => marker.properties.kind === "player_spawn")!;
const residents = markers.filter((marker) => ["npc", "npc_spawn"].includes(marker.properties.kind));
// Recast the existing supported markers without changing the exported city asset.
export const KYOTO_PLACEMENT_SOURCE: Record<string, string> = { cafe_owner: 'kissa_aoi_host', kissa_aoi_host: 'cafe_owner' };
const placementFor = (id: string) => residents.find(marker => marker.properties.npc_id === (KYOTO_PLACEMENT_SOURCE[id] ?? id))!;
const tutorVenues = [{ id: 'kissa_aoi', name: 'Kissa Aoi · Coffee shop', npcId: 'cafe_owner' }, { id: 'restaurant_momiji', name: 'Restaurant Momiji', npcId: 'restaurant_momiji_host' }].map(venue => {
  const floor = gameplay.colliders.find(collider => collider.name === `SM_COL_${venue.id}_floor`)!;
  // These two exported floors are axis-aligned in world space (0° or 90°).
  const rotated = Math.abs(floor.quaternion[1]) > .5;
  const halfX = floor.halfExtents[rotated ? 2 : 0], halfZ = floor.halfExtents[rotated ? 0 : 2];
  return { ...venue,
    entry: markers.find(marker => marker.name === `MARK_entry_${venue.id}`)!.position,
    meetingPoint: markers.find(marker => marker.name === `MARK_interaction_${venue.id}`)!.position,
    bounds: { min: [floor.position[0] - halfX + .25, 0, floor.position[2] - halfZ + .25], max: [floor.position[0] + halfX - .25, 3, floor.position[2] + halfZ - .25] },
  };
});
export const KYOTO_ENVIRONMENT = environmentSchema.parse({
  id: "komorebi-city", revision: "kyoto-city-v4-tutor-shops-20260913", name: "Komorebi · Kyoto City",
  assetUrl: "/models/kyoto/kyoto_city_lod1.glb", spawn: spawn.position,
  bounds: { min: [-34, -4, -27], max: [34, 24, 27] }, colliders: [],
  npcSpawns: Object.fromEntries(residents.map((marker) => [marker.properties.npc_id, placementFor(marker.properties.npc_id!).position])),
  venues: tutorVenues,
  // Street parking checked with the authority's supported-position/footprint query.
  vehicleSpawns: [
    { id: "scooter_riverside", kind: "scooter", position: [4.8, 0.27, 8.6], yaw: 0 },
    { id: "skateboard_riverside", kind: "skateboard", position: [4.1, 0.27, 11.2], yaw: Math.PI / 2 },
    { id: "scooter_east_street", kind: "scooter", position: [20, 0.27, 12], yaw: Math.PI },
    { id: "scooter_west_street", kind: "scooter", position: [-20, 0.27, 12], yaw: 0 },
    { id: "skateboard_north_market", kind: "skateboard", position: [11, 0.27, -18.3], yaw: -Math.PI / 2 },
    { id: "skateboard_south_market", kind: "skateboard", position: [-11, 0.27, 18.4], yaw: Math.PI / 2 },
  ],
  physics: { colliders: gameplay.colliders, stepHeight: 0.22, maxSlopeDegrees: 35, groundSnap: 0.30, gravity: -9.81 },
  lights: gameplay.lights.map((light) => ({position: light.position, color: light.color, intensity: light.runtime_intensity, range: light.range})),
});
export const KYOTO_NPCS = residents.map((marker) => {
  const id = marker.properties.npc_id!;
  const identity = CHARACTER_PRESETS[id as keyof typeof CHARACTER_PRESETS];
  if (!identity) throw new Error(`Missing character preset: ${id}`);
  const placement = placementFor(id);
  const interaction = markers.find((candidate) => candidate.name === `MARK_interaction_${placement.properties.venue_id}`);
  const yaw = interaction ? Math.atan2(interaction.position[0] - placement.position[0], interaction.position[2] - placement.position[2]) : 0;
  return npcSchema.parse({ id, name: identity.name, role: id === 'kissa_aoi_host' ? 'Riverside barista' : identity.role, scenarioId: `practice-${id}`,
    position: placement.position, yaw, interactionRadius: placement.properties.interaction_radius ?? 2.8,
    avatarUrl: "/models/characters/komorebi_npc.glb" });
});
