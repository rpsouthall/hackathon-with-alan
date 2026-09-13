export interface LessonRuntime {
  [key: string]: string | undefined;
  OPENAI_API_KEY?: string;
  LIVEAVATAR_API_KEY?: string;
  LIVEAVATAR_AVATAR_ID?: string;
  LESSON_ASSESSMENT_MODEL?: string;
}
export const capabilities = (runtime: LessonRuntime = process.env) => ({
  aiFeedback: !!runtime.OPENAI_API_KEY,
  liveAvatar: !!(runtime.OPENAI_API_KEY && runtime.LIVEAVATAR_API_KEY && runtime.LIVEAVATAR_AVATAR_ID),
  missing: (['OPENAI_API_KEY', 'LIVEAVATAR_API_KEY', 'LIVEAVATAR_AVATAR_ID'] as const).filter(key => !runtime[key]),
});
