import test from 'node:test';
import assert from 'node:assert/strict';
import { scenarios, scenarioForNpc } from '../../lib/lesson/scenarios';

test('all three world NPCs have distinct ten-question lessons', () => {
  assert.deepEqual(scenarios.map(s => s.id).sort(), ['coffee', 'market', 'restaurant']);
  assert.equal(new Set(scenarios.map(s => s.npcId)).size, 3);
  for (const scenario of scenarios) {
    assert.equal(scenario.questions.length, 10, scenario.id);
    assert.equal(new Set(scenario.questions.map(q => q.id)).size, 10);
    assert.equal(scenarioForNpc(scenario.npcId).id, scenario.id);
    assert.ok(scenario.questions.some(q => q.kind === 'roleplay'));
    assert.ok(scenario.questions.some(q => q.kind === 'meaning'));
    assert.ok(scenario.questions.some(q => q.kind === 'politeness'));
    assert.ok(scenario.questions.some(q => q.kind === 'fill'));
  }
});

test('every quiz has one valid answer and every roleplay has teaching content', () => {
  for (const scenario of scenarios) for (const question of scenario.questions) {
    const label = `${scenario.id}/${question.id}`;
    for (const field of ['japanese', 'meaning', 'task', 'modelAnswer', 'answerMeaning', 'reading', 'tip'] as const) assert.ok(question[field].trim(), `${label}: ${field}`);
    if (question.kind !== 'roleplay') {
      assert.ok(question.options && question.options.length >= 3, label);
      assert.equal(new Set(question.options).size, question.options.length, label);
      assert.ok(Number.isInteger(question.correctIndex), label);
      assert.ok(question.correctIndex! >= 0 && question.correctIndex! < question.options.length, label);
      // A translation of the model reply is also valid: never offer it as a
      // supposedly wrong choice beside that same reply in Japanese.
      question.options.forEach((option, index) => {
        if (index !== question.correctIndex) {
          assert.notEqual(option.trim().toLowerCase(), question.answerMeaning.trim().toLowerCase(), `${label}: equivalent answer offered as a distractor`);
        }
      });
    } else {
      assert.equal(question.options, undefined, label);
      assert.equal(question.correctIndex, undefined, label);
    }
  }
});

// Confusing these two translations would teach the learner the wrong phrase.
test('model-answer translations are separate from the NPC question translation', () => {
  const welcome = scenarioForNpc('cafe_owner').questions[0];
  assert.equal(welcome.answerMeaning, 'Yes, just me.');
  assert.notEqual(welcome.answerMeaning, welcome.meaning);
  assert.equal(scenarioForNpc('shopkeeper').id, 'market');
  assert.equal(scenarioForNpc('local_guide').id, 'restaurant');
});
