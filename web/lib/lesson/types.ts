export type LessonDifficulty = 'easy' | 'difficult';
export type NativeLanguage = 'English' | 'Mandarin Chinese' | 'Spanish' | 'Japanese';
export type QuizKind = 'roleplay' | 'meaning' | 'politeness' | 'fill';
export interface Question { difficulty?: LessonDifficulty; id: string; kind: QuizKind; japanese: string; meaning: string; task: string; modelAnswer: string; answerMeaning: string; reading: string; tip: string; options?: string[]; correctIndex?: number }
export interface Scenario { difficulty?: LessonDifficulty; id: string; npcId: string; title: string; name: string; location: string; description: string; questions: Question[] }
export interface Feedback { verdict: 'correct' | 'improve' | 'try_again'; explanation: string; japanese: string; reading: string; meaning: string; answer: string }
export interface Turn { id: string; role: 'user' | 'assistant'; text: string; done: boolean }
export interface LessonRewards { points: number; answered: number; spoken: number; correct: number; quizzesAnswered: number; quizzesCorrect: number; lastEarned: number }
export interface LessonSnapshot { difficulty?: LessonDifficulty | null; rewards: LessonRewards; scenarioId: string; index: number; attempts: number; feedback: Feedback | null; completed: boolean; reviewed: number }
export type LessonEvent =
 | { type: 'connected'; live: boolean; lesson: LessonSnapshot }
 | { type: 'ready' }
 | { type: 'live-starting' }
 | { type: 'avatar'; url: string; token: string }
 | { type: 'lesson'; lesson: LessonSnapshot }
 | { type: 'turn'; turn: Turn }
 | { type: 'checking' }
 | { type: 'error'; message: string }
 | { type: 'ended' };
