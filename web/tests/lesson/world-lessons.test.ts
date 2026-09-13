import test from 'node:test';
import assert from 'node:assert/strict';
import { KYOTO_NPCS } from '../../lib/world/kyoto';
import { scenarios, scenarioForNpc } from '../../lib/lesson/scenarios';
import { lessonNpcForWorldNpc } from '../../lib/lesson/world-lessons';

test('the playable city reaches all three lessons through matching venues', () => {
  const reachable = KYOTO_NPCS.map(npc => lessonNpcForWorldNpc(npc.id))
    .filter((id): id is string => !!id).map(id => scenarioForNpc(id).id);
  assert.deepEqual([...new Set(reachable)].sort(), scenarios.map(scenario => scenario.id).sort());
  assert.equal(scenarioForNpc(lessonNpcForWorldNpc('market_produce')!).id, 'market');
  assert.equal(scenarioForNpc(lessonNpcForWorldNpc('restaurant_momiji_host')!).id, 'restaurant');
  assert.equal(scenarioForNpc(lessonNpcForWorldNpc('kissa_aoi_host')!).id, 'coffee');
});

test('unrelated city residents do not accidentally start the coffee lesson', () => {
  for (const npc of ['local_guide', 'inn_host', 'bookshop_tsuki_host', 'unknown']) {
    assert.equal(lessonNpcForWorldNpc(npc), undefined, npc);
  }
});
