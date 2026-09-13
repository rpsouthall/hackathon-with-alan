/** Shared by the browser and authority. Speeds and gesture timing are never client-authored. */
export const WALK_SPEED = 3;
export const SPRINT_SPEED = 5.5;
export const EMOTE_NAMES = ["wave", "bow", "cheer", "nod"] as const;
export type EmoteName = typeof EMOTE_NAMES[number];
export const EMOTES = {
  wave: { label: "Wave", japanese: "こんにちは", animation: "Wave", duration: 2 },
  bow: { label: "Bow", japanese: "ありがとう", animation: "Bow", duration: 2.2 },
  cheer: { label: "Cheer", japanese: "やった！", animation: "Cheer", duration: 2.4 },
  nod: { label: "Nod", japanese: "うん", animation: "Nod", duration: 1.6 },
} as const;
