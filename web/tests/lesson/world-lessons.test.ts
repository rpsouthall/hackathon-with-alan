import test from 'node:test';
import assert from 'node:assert/strict';
import { KYOTO_NPCS } from '../../lib/world/kyoto';
import { scenarios, scenarioForNpc } from '../../lib/lesson/scenarios';
import { lessonNpcForWorldNpc } from '../../lib/lesson/world-lessons';
import { lessonCharacters, lessonCharacterForWorldNpc, scenarioForCharacter } from '../../lib/lesson/characters';

test('the playable city reaches all lessons through matching characters', () => {
  const reachable = KYOTO_NPCS.map(npc => lessonNpcForWorldNpc(npc.id))
    .filter((id): id is string => !!id).map(id => scenarioForNpc(id).id);
  assert.deepEqual([...new Set(reachable)].sort(), scenarios.map(scenario => scenario.id).sort());
  assert.equal(scenarioForNpc(lessonNpcForWorldNpc('market_produce')!).id, 'market');
  assert.equal(scenarioForNpc(lessonNpcForWorldNpc('restaurant_momiji_host')!).id, 'restaurant');
  assert.equal(scenarioForNpc(lessonNpcForWorldNpc('kissa_aoi_host')!).id, 'coffee');
});

test('unrelated city residents do not accidentally start the coffee lesson', () => {
  for (const npc of ['bookshop_tsuki_host', 'shopkeeper', 'unknown']) {
    assert.equal(lessonNpcForWorldNpc(npc), undefined, npc);
  }
});

test('teachers without an avatar or a valid lesson cannot be selected or routed', () => {
  const base = lessonCharacters[0];
  for (const change of [{ avatarId: '' }, { avatarId: '   ' }, { scenarioId: 'missing-lesson' }]) {
    const candidate = { ...base, ...change, id: 'unassigned-teacher' };
    lessonCharacters.push(candidate);
    try {
      assert.equal(lessonCharacterForWorldNpc(candidate.id), undefined);
      assert.equal(lessonNpcForWorldNpc(candidate.id), undefined);
    } finally { lessonCharacters.pop(); }
  }
});

test('the featured neighbours use the selected cast while keeping their lesson identities', () => {
  const featured = ['cafe_owner', 'local_guide', 'inn_host', 'market_produce', 'market_tea'].map(id => lessonCharacterForWorldNpc(id)!);
  assert.deepEqual(featured.map(character => character.avatarName), ['Rika Sitting', 'Wayne', 'Pedro Sitting', 'June HR', 'Wayne']);
  assert.equal(featured[1].avatarId, featured[4].avatarId, 'Haru and Sora intentionally share the selected Wayne appearance');
  assert.deepEqual(featured.map(character => character.scenarioId), ['coffee', 'directions', 'inn', 'market', 'tea']);
  for (const character of lessonCharacters) {
    const lesson = scenarioForCharacter(character);
    assert.equal(lesson.name, character.name);
    assert.equal(lesson.id, character.scenarioId);
    assert.equal(lesson.questions.length, 10);
    assert.match(character.avatarId, /^[a-f0-9-]{36}$/);
  }
  assert.match(scenarioForCharacter(featured[0]).questions[0].task, /Aoi/);
  assert.match(scenarioForCharacter(featured[3]).questions[0].task, /Yui/);
  assert.equal(lessonCharacterForWorldNpc('arbitrary-avatar-id'), undefined);
});
