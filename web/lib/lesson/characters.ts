import { scenarios } from './scenarios';
import type { Scenario } from './types';

export interface LessonCharacter {
  id: string; name: string; role: string; scenarioId: string;
  avatarId: string; avatarName: string; preview: string; voice: 'marin' | 'cedar';
}

// Public ACTIVE LiveAvatar IDs verified through /v1/avatars/public on 2026-09-13.
// These are actor appearances, not assertions about the actors' nationality.
const avatars = {
  rika: { avatarId: '5dd4d830-957a-419f-9334-0dc4399ada5d', avatarName: 'Rika Sitting', preview: '/avatars/rika.webp', voice: 'marin' as const },
  wayne: { avatarId: 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a', avatarName: 'Wayne', preview: '/avatars/wayne.webp', voice: 'cedar' as const },
  pedro: { avatarId: '7a517e8e-b41f-49e7-b6b3-2cdfb4bbff1e', avatarName: 'Pedro Sitting', preview: '/avatars/pedro.webp', voice: 'cedar' as const },
  june: { avatarId: '65f9e3c9-d48b-4118-b73a-4ae2e3cbb8f0', avatarName: 'June HR', preview: '/avatars/june.webp', voice: 'marin' as const },
};
export const lessonCharacters: LessonCharacter[] = [
  { id: 'cafe_owner', name: 'Aoi', role: 'Café owner', scenarioId: 'coffee', ...avatars.rika },
  { id: 'local_guide', name: 'Haru', role: 'Local guide', scenarioId: 'directions', ...avatars.wayne },
  { id: 'inn_host', name: 'Ren', role: 'Inn host', scenarioId: 'inn', ...avatars.pedro },
  { id: 'market_produce', name: 'Yui', role: 'Produce seller', scenarioId: 'market', ...avatars.june },
  // Sharing Wayne with Haru is the user's selected casting choice.
  { id: 'market_tea', name: 'Sora', role: 'Tea seller', scenarioId: 'tea', ...avatars.wayne },
  { id: 'kissa_aoi_host', name: 'Nao', role: 'Barista', scenarioId: 'coffee', ...avatars.wayne },
  { id: 'restaurant_momiji_host', name: 'Koharu', role: 'Restaurant host', scenarioId: 'restaurant', ...avatars.rika },
  { id: 'tea_hanami_host', name: 'Kaede', role: 'Tea host', scenarioId: 'tea', ...avatars.june },
];

/** Only assigned avatars with a real lesson may be offered as live teachers. */
export const lessonCharacterForWorldNpc = (id: string) => lessonCharacters.find(character =>
  character.id === id && !!character.avatarId.trim() && scenarios.some(scenario => scenario.id === character.scenarioId));

/** Use the same identity in lesson copy, assessment tasks and the live prompt. */
export function scenarioForCharacter(character: LessonCharacter): Scenario {
  const template = scenarios.find(scenario => scenario.id === character.scenarioId);
  if (!template) throw new Error('This character has no lesson.');
  const rename = (text: string) => text.replaceAll(template.name, character.name);
  return { ...template, name: character.name, description: rename(template.description),
    questions: template.questions.map(question => ({ ...question, task: rename(question.task) })) };
}

/** Match the voice to the server-selected avatar, including lesson-lab fallbacks. */
export const voiceForAvatar = (avatarId?: string): LessonCharacter['voice'] =>
  Object.values(avatars).find(avatar => avatar.avatarId === avatarId)?.voice ?? 'marin';
