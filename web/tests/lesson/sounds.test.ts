import test from 'node:test';
import assert from 'node:assert/strict';
import { rewardCue } from '../../lib/lesson/sounds';
import { LessonEngine } from '../../lib/lesson/engine';
import { scenarios } from '../../lib/lesson/scenarios';

test('reward sounds prioritize correct answers, suppress repeated snapshots, and celebrate completion once', () => {
  const engine = new LessonEngine({ ...scenarios[0], questions: [scenarios[0].questions[0]] });
  const before = engine.state;
  engine.finish(engine.begin(engine.question.id), { verdict: 'correct', answer: '', japanese: '', explanation: '', reading: '', meaning: '' });
  const answered = engine.state;
  assert.equal(rewardCue(before, answered), 'correct');
  assert.equal(rewardCue(answered, { ...answered }), null);
  engine.next(engine.question.id);
  assert.equal(rewardCue(answered, engine.state), 'complete');
  assert.equal(rewardCue(engine.state, engine.state), null);
  assert.equal(rewardCue(engine.state, before), null);
});
test('practice points have a softer cue, and retrying without additional points stays quiet', () => {
  const engine = new LessonEngine(scenarios[0]);
  const before = engine.state;
  const feedback = { verdict: 'try_again' as const, answer: '', japanese: '', explanation: '', reading: '', meaning: '' };
  engine.finish(engine.begin(engine.question.id), feedback);
  assert.equal(rewardCue(before, engine.state), 'points');
  engine.retry(engine.question.id);
  const retry = engine.state;
  engine.finish(engine.begin(engine.question.id), feedback);
  assert.equal(rewardCue(retry, engine.state), null);
});
