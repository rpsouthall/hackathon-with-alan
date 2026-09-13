import type { NpcSnapshot } from "@/lib/world/schema";

export type ExperiencePhase = "explore" | "conversation" | "results";
export type NpcId = string;

export interface NpcDefinition {
  id: NpcId;
  name: string;
  nameJapanese: string;
  role: string;
  objective: string;
  level: "N5" | "N4" | "N3";
  accent: string;
}

export interface TranscriptLine {
  id: string;
  speaker: "npc" | "learner";
  japanese: string;
  translation: string;
}

// Presentation only. The room supplies the available cast, positions and encounter state.
export const npcs: NpcDefinition[] = [
  { id: "cafe_owner", name: "Aoi", nameJapanese: "葵", role: "Tea house host", objective: "Order tea and ask for a recommendation", level: "N5", accent: "#b96550" },
  { id: "local_guide", name: "Haru", nameJapanese: "春", role: "Local guide", objective: "Ask for directions to the temple", level: "N4", accent: "#628778" },
  { id: "inn_host", name: "Ren", nameJapanese: "蓮", role: "Inn host", objective: "Check in and ask about breakfast", level: "N4", accent: "#536585" },
];

export function npcPresentation(npc: NpcSnapshot): NpcDefinition {
  const known = npcs.find((entry) => entry.id === npc.id);
  return known ? { ...known, name: npc.name, role: npc.role } : {
    id: npc.id, name: npc.name, nameJapanese: npc.name.slice(0, 1), role: npc.role,
    objective: "Introduce yourself and learn about Kyoto", level: "N5", accent: "#79705d",
  };
}
