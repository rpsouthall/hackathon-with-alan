import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LessonEngine, gradeChoice } from '../../lib/lesson/engine';
import { scenarios } from '../../lib/lesson/scenarios';
import type { Feedback } from '../../lib/lesson/types';

const feedback: Feedback = { verdict: 'correct', explanation: 'Clear meaning.', answer: 'One coffee, please.', japanese: 'コーヒーをお願いします。', reading: 'Kōhī o onegaishimasu.', meaning: 'A coffee, please.' };
test('progress requires feedback, blocks overlapping answers and rejects stale completions', () => {
  const engine = new LessonEngine(scenarios[0]);
  assert.throws(() => engine.next(engine.question.id));
  assert.throws(() => engine.begin('wrong-id'));
  const first = engine.begin(engine.question.id);
  assert.throws(() => engine.begin(engine.question.id));
  engine.cancel(first);
  const second = engine.begin(engine.question.id);
  assert.equal(engine.finish(first, feedback), false);
  assert.equal(engine.finish(second, feedback), true);
  assert.equal(engine.finish(second, feedback), false);
  assert.equal(engine.state.attempts, 1);
  engine.retry(engine.question.id);
  assert.equal(engine.state.index, 0);
  assert.equal(engine.state.feedback, null);
  assert.throws(() => engine.next(engine.question.id));
});
test('ten reviewed questions complete once without inventing a score', () => {
  const engine = new LessonEngine(scenarios[0]);
  for (let i = 0; i < 10; i++) {
    assert.equal(engine.state.index, i);
    const id = engine.question.id;
    engine.finish(engine.begin(id), feedback);
    engine.next(id);
  }
  assert.equal(engine.state.completed, true);
  assert.equal(engine.state.reviewed, 10);
  assert.equal(engine.state.index, 9);
  assert.throws(() => engine.next(engine.question.id));
  assert.throws(() => engine.begin(engine.question.id));
  assert.equal('score' in engine.state, false);
});
test('choices assess the selected answer and translate the reply, not the NPC question', () => {
  const question = scenarios[0].questions.find(q => q.options)!;
  assert.equal(gradeChoice(question, question.correctIndex!).verdict, 'correct');
  const wrong = (question.correctIndex! + 1) % question.options!.length;
  const result = gradeChoice(question, wrong);
  assert.equal(result.verdict, 'try_again');
  assert.equal(result.answer, question.options![wrong]);
  assert.equal(result.meaning, question.answerMeaning);
  assert.throws(() => gradeChoice(question, -1));
  assert.throws(() => gradeChoice(question, 3.5));
});
