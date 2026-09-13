import type { Feedback, LessonSnapshot, Question, Scenario } from './types';

/** Progress belongs to the lesson controller, never to model-generated text. */
export class LessonEngine {
  state: LessonSnapshot;
  private revision = 0;
  private busy = false;
  constructor(readonly scenario: Scenario) {
    this.state = { scenarioId: scenario.id, index: 0, attempts: 0, feedback: null, completed: false, reviewed: 0 };
  }
  get question(): Question { return this.scenario.questions[this.state.index]; }
  begin(questionId: string): number {
    if (this.state.completed || this.busy || questionId !== this.question.id) throw new Error('Wait for feedback on the current question.');
    this.busy = true;
    return ++this.revision;
  }
  finish(ticket: number, feedback: Feedback): boolean {
    if (ticket !== this.revision || !this.busy) return false;
    this.busy = false;
    this.state = { ...this.state, attempts: this.state.attempts + 1, feedback };
    return true;
  }
  cancel(ticket?: number): void {
    if (ticket !== undefined && ticket !== this.revision) return;
    this.revision++;
    this.busy = false;
  }
  retry(questionId: string): void {
    if (this.busy || this.state.completed || questionId !== this.question.id) throw new Error('Wait for the current answer to finish.');
    this.state = { ...this.state, feedback: null };
  }
  next(questionId: string): void {
    if (this.busy || !this.state.feedback || this.state.completed || questionId !== this.question.id) throw new Error('Answer this question and review your feedback first.');
    const completed = this.state.index === this.scenario.questions.length - 1;
    this.state = { ...this.state, reviewed: this.state.index + 1, completed, index: this.state.index + (completed ? 0 : 1), feedback: null };
  }
}

export function gradeChoice(question: Question, index: number): Feedback {
  if (!question.options || !Number.isInteger(index) || index < 0 || index >= question.options.length) throw new Error('Choose one of the available answers.');
  const correct = index === question.correctIndex;
  return { verdict: correct ? 'correct' : 'try_again', answer: question.options[index],
    explanation: `${correct ? 'That’s right.' : `The best answer is “${question.options[question.correctIndex!]}”.`} ${question.tip}`,
    japanese: question.modelAnswer, reading: question.reading, meaning: question.answerMeaning };
}
