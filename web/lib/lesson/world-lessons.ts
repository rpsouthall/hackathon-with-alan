import { scenarios } from './scenarios';
import { lessonCharacterForWorldNpc } from './characters';

// Ryan's city has a larger cast than the original three-person blockout.
// Only matching venues start a guided lesson; other residents keep their
// existing neighbourhood dialogue instead of falling back to a coffee order.
const venueLessons: Record<string, string> = {
  cafe_owner: 'coffee',
  kissa_aoi_host: 'coffee',
  market_produce: 'market',
  restaurant_momiji_host: 'restaurant',
  shopkeeper: 'market',
};

export function lessonNpcForWorldNpc(npcId: string): string | undefined {
  const lessonId = lessonCharacterForWorldNpc(npcId)?.scenarioId ?? venueLessons[npcId];
  return scenarios.find(scenario => scenario.id === lessonId)?.npcId;
}
