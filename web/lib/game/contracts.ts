export type ExperiencePhase = "explore" | "conversation" | "results";

export type NpcId = "cafe_owner" | "local_guide" | "shopkeeper";

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

export interface ConversationScore {
  overall: number;
  taskCompletion: number;
  comprehension: number;
  grammar: number;
  politeness: number;
}

// Presentation only. Positions, environment and encounter state come from useWorld().
export const npcs: NpcDefinition[] = [
  { id: "cafe_owner", name: "Aiko", nameJapanese: "愛子", role: "Coffee shop host", objective: "Order a coffee and practise polite requests", level: "N5", accent: "#f29b73" },
  { id: "local_guide", name: "Haru", nameJapanese: "春", role: "Restaurant host", objective: "Find a table, order a meal, and ask for the bill", level: "N4", accent: "#8db9a6" },
  { id: "shopkeeper", name: "Mei", nameJapanese: "芽衣", role: "Fruit seller", objective: "Choose fruit, ask prices, and pay", level: "N4", accent: "#e4bd68" },
];
