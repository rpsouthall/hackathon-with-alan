import { appearanceSchema, type PlayerAppearance } from "../world/schema";
import cityCast from "./city-cast.json";

export type CharacterPreset = {
  id: string;
  name: string;
  role: string;
  appearance: PlayerAppearance;
};

export type CharacterId = keyof typeof cityCast.characters;

/** Stable export from the character workshop. Identity never becomes player cosmetics. */
export const CHARACTER_PRESETS = Object.freeze(Object.fromEntries(
  Object.entries(cityCast.characters).map(([key, character]) => {
    const { id, name, role, ...cosmetics } = character;
    if (key !== id) throw new Error(`Character catalog key ${key} does not match its identity ${id}.`);
    return [key, Object.freeze({ id, name, role, appearance: Object.freeze(appearanceSchema.parse(cosmetics)) })];
  }),
) as Record<CharacterId, CharacterPreset>);

export const MATERIAL_CHANNELS = {
  skin: "Skin", hairColor: "Hair", top: "Top", accent: "Accent", trousers: "Trousers", shoes: "Shoes",
} as const;

export const ANIMATIONS = ["Idle", "Walk", "Run", "Wave", "Bow", "Talk", "Listen"] as const;
export type AvatarAnimation = typeof ANIMATIONS[number] | "Cheer" | "Nod";
