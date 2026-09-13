import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { levelQuestion, parseDifficulty, scenarioAtDifficulty, speechInstruction } from '../../lib/lesson/difficulty';
import { scenarios } from '../../lib/lesson/scenarios';
import { lessonCharacters, scenarioForCharacter } from '../../lib/lesson/characters';
import { attachLessonSession } from '../../server/lesson/session';
import { LiveSessionSlot } from '../../server/lesson/live-slot';
import type { LiveSink } from '../../server/lesson/live';
import type { LessonSocket } from '../../server/lesson/socket';
import type { LessonEvent, Question } from '../../lib/lesson/types';

test('recognises an unambiguous English or Japanese level and asks again otherwise', () => {
  for (const text of ['Easy please', 'beginner', 'やさしいです', '簡単な方']) assert.equal(parseDifficulty(text), 'easy');
  for (const text of ['Difficult please', 'hard', '難しい方', 'むずかしい']) assert.equal(parseDifficulty(text), 'difficult');
  for (const text of ['easy or difficult', 'やさしいか難しい', 'hello', '']) assert.equal(parseDifficulty(text), null);
});

test('every tutor has ten distinct difficulty-adjusted tasks without mutating the source', () => {
  for (const character of lessonCharacters) {
    const base = scenarioForCharacter(character), before = JSON.stringify(base);
    const easy = scenarioAtDifficulty(base, 'easy'), hard = scenarioAtDifficulty(base, 'difficult');
    assert.equal(easy.questions.length, 10); assert.equal(hard.questions.length, 10);
    assert.equal(easy.name, character.name); assert.equal(hard.name, character.name);
    for (let i = 0; i < 10; i++) {
      assert.equal(easy.questions[i].modelAnswer, base.questions[i].modelAnswer);
      assert.notEqual(hard.questions[i].task, easy.questions[i].task);
      assert.ok(hard.questions[i].modelAnswer.startsWith(base.questions[i].modelAnswer));
      assert.equal(hard.questions[i].options, undefined);
      assert.match(speechInstruction(hard.questions[i]), /difficult/);
    }
    assert.equal(JSON.stringify(base), before);
  }
});

for (const mode of ['voice', 'button'] as const) test(`${mode} level choices start at zero points; ambiguous or late preference transcripts cannot be graded`, async () => {
  const emitter = new EventEmitter();
  const events: LessonEvent[] = [], asked: Question[] = [];
  let sink!: LiveSink;
  const socket = Object.assign(emitter, { readyState: 1, bufferedAmount: 0, send: (raw: string) => events.push(JSON.parse(raw)), close: () => emitter.emit('close'), terminate() {} }) as LessonSocket;
  const bridge = { start: async () => { sink.ready(); }, close: async () => {}, audio() {}, feedback() {}, avatarReady() {}, ask: (question: Question) => asked.push(question) };
  const attached = attachLessonSession(socket, { runtime: { OPENAI_API_KEY: 'test', LIVEAVATAR_API_KEY: 'test', LIVEAVATAR_AVATAR_ID: 'test' }, liveSlot: new LiveSessionSlot(), createBridge: (_scenario, _language, question, callbacks) => { asked.push(question); sink = callbacks; return bridge; } });
  const send = async (input: object) => { emitter.emit('message', JSON.stringify(input)); await new Promise(resolve => setImmediate(resolve)); };
  try {
    await send({ type: 'start', scenarioId: scenarios[0].id, language: 'English' });
    await send({ type: 'answer', questionId: scenarios[0].questions[0].id, answer: 'easy' });
    assert.match((events.at(-1) as { message: string }).message, /Choose easy or difficult/);
    await send({ type: 'live' });
    assert.equal(asked[0].id, levelQuestion.id);
    sink.turn({ id: 'unclear', role: 'user', text: 'easy or difficult', done: true });
    assert.equal(asked.at(-1)?.id, levelQuestion.id);
    sink.turn({ id: 'preference', role: 'user', text: 'difficult', done: false });
    if (mode === 'button') await send({ type: 'difficulty', difficulty: 'easy' });
    sink.turn({ id: 'preference', role: 'user', text: 'difficult please', done: true });
    assert.equal(asked.at(-1)?.difficulty, mode === 'button' ? 'easy' : 'difficult');
    const state = events.filter(event => event.type === 'lesson').at(-1);
    assert.ok(state?.type === 'lesson');
    assert.equal(state.lesson.difficulty, mode === 'button' ? 'easy' : 'difficult');
    assert.equal(state.lesson.rewards.points, 0);
    assert.equal(state.lesson.index, 0);
    assert.equal(state.lesson.feedback, null);
    await send({ type: 'difficulty', difficulty: 'difficult' });
    assert.match((events.at(-1) as { message: string }).message, /new lesson/);
  } finally { await attached.close(); }
});
