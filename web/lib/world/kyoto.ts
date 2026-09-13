import gameplay from "./data/kyoto-city-gameplay.json";
import { CHARACTER_PRESETS } from "../characters/presets";
import { environmentSchema, npcSchema } from "./schema";

// The asset release and its exported physics/markers always travel together.
const markers = gameplay.markers;
const spawn = markers.find((marker) => marker.properties.kind === "player_spawn")!;
const residents = markers.filter((marker) => ["npc", "npc_spawn"].includes(marker.properties.kind));
export const KYOTO_ENVIRONMENT = environmentSchema.parse({
  id: "komorebi-city", revision: "kyoto-city-v3-vehicles-20260913", name: "Komorebi · Kyoto City",
  assetUrl: "/models/kyoto/kyoto_city_lod1.glb", spawn: spawn.position,
  bounds: { min: [-34, -4, -27], max: [34, 24, 27] }, colliders: [],
  npcSpawns: Object.fromEntries(residents.map((marker) => [marker.properties.npc_id, marker.position])),
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
  const interaction = markers.find((candidate) => candidate.name === `MARK_interaction_${marker.properties.venue_id}`);
  const yaw = interaction ? Math.atan2(interaction.position[0] - marker.position[0], interaction.position[2] - marker.position[2]) : 0;
  return npcSchema.parse({ id, name: identity.name, role: identity.role, scenarioId: `practice-${id}`,
    position: marker.position, yaw, interactionRadius: marker.properties.interaction_radius ?? 2.8,
    avatarUrl: "/models/characters/komorebi_npc.glb" });
});
