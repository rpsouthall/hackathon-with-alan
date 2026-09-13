import { scenarios } from './scenarios';
import { lessonCharacterForWorldNpc } from './characters';

export function lessonNpcForWorldNpc(npcId: string): string | undefined {
  const lessonId = lessonCharacterForWorldNpc(npcId)?.scenarioId;
  return scenarios.find(scenario => scenario.id === lessonId)?.npcId;
}
