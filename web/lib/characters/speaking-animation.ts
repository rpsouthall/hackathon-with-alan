import type { CharacterAvatar } from "./avatar";

export type SpeakingAnimationOptions = {
  moving: boolean;
  emoting: boolean;
  listening: boolean;
};

/** Select speech after locomotion/emotes, before the avatar's animation update. */
export function updateSpeakingAnimation(
  avatar: CharacterAvatar,
  speaking: boolean,
  { moving, emoting, listening }: SpeakingAnimationOptions,
): void {
  if (moving || emoting || avatar.riding) return;
  // Speech only owns ambient clips; explicit gestures finish uninterrupted.
  if (avatar.current !== "Idle" && avatar.current !== "Listen" && avatar.current !== "Talk") return;
  avatar.play(speaking ? "Talk" : listening ? "Listen" : "Idle");
}
