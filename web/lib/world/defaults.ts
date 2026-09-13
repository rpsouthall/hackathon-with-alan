import { environmentSchema, type NpcSnapshot } from "./schema";

export const DEFAULT_ENVIRONMENT = environmentSchema.parse({
  id: "kyoto-courtyard", revision: "blockout-v1", name: "Kyoto courtyard",
  assetUrl: null, spawn: [0, 0, 4],
  bounds: { min: [-12, -1, -12], max: [12, 8, 12] },
  colliders: [
    { min: [-10, -0.1, -9], max: [-5, 4, -3] },
    { min: [5, -0.1, -9], max: [10, 4, -3] },
  ],
  npcSpawns: { cafe_owner: [-3, 0, 0], local_guide: [3, 0, 0], shopkeeper: [0, 0, -5] },
});

export const DEFAULT_NPCS: NpcSnapshot[] = [
  { id: "cafe_owner", name: "Aiko", role: "Café owner", scenarioId: "coffee", interactionRadius: 2.5, avatarUrl: null, position: [-3, 0, 0] },
  { id: "local_guide", name: "Haru", role: "Restaurant host", scenarioId: "restaurant", interactionRadius: 2.5, avatarUrl: null, position: [3, 0, 0] },
  { id: "shopkeeper", name: "Mei", role: "Fruit seller", scenarioId: "market", interactionRadius: 2.5, avatarUrl: null, position: [0, 0, -5] },
];
