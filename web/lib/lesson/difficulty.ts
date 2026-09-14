import type { LessonDifficulty, Question, Scenario } from './types';

export const levelQuestion: Question = {
  id: 'choose-level', kind: 'roleplay',
  japanese: 'やさしいレッスンと、難しいレッスン、どちらがいいですか？',
  meaning: 'Would you like an easy or difficult lesson?',
  task: 'Choose easy or difficult. You can say your choice or use the buttons.',
  modelAnswer: '', answerMeaning: '', reading: '', tip: '',
};

/** A choice must contain exactly one recognised level; never guess from an ambiguous reply. */
export function parseDifficulty(text: string): LessonDifficulty | null {
  const easy = /\b(easy|easier|beginner|simple)\b|やさし|優し|かんたん|簡単|初級/i.test(text);
  const difficult = /\b(difficult|hard|harder|advanced)\b|むずかし|難し|上級/i.test(text);
  return easy === difficult ? null : easy ? 'easy' : 'difficult';
}

// Add a different conversational skill to each difficult exchange. These are
// assessed together with the scenario-specific response, not as extra steps.
const challenges = [
  ['Ask them to speak a little more slowly.', 'もう少しゆっくり話していただけますか。', 'Mō sukoshi yukkuri hanashite itadakemasu ka.', 'Could you speak a little more slowly?'],
  ['Ask them to say that once more.', 'もう一度言っていただけますか。', 'Mō ichido itte itadakemasu ka.', 'Could you say that once more?'],
  ['Explain that this is your first visit.', 'こちらに来るのは初めてなので、少し緊張しています。', 'Kochira ni kuru no wa hajimete na node, sukoshi kinchō shite imasu.', 'This is my first visit here, so I am a little nervous.'],
  ['Ask for a recommendation and its reason.', 'おすすめと、その理由を教えていただけますか。', 'Osusume to, sono riyū o oshiete itadakemasu ka.', 'Could you tell me your recommendation and why?'],
  ['Ask whether another option is available.', 'ほかの選択肢もありますか。', 'Hoka no sentakushi mo arimasu ka.', 'Are there other options too?'],
  ['Politely ask for a moment to think.', '少し考えたいので、待っていただけますか。', 'Sukoshi kangaetai node, matte itadakemasu ka.', 'I would like to think for a moment, so could you wait?'],
  ['Explain that you are learning Japanese and invite a correction.', '日本語を勉強しているので、間違っていたら教えてください。', 'Nihongo o benkyō shite iru node, machigatte itara oshiete kudasai.', 'I am studying Japanese, so please tell me if I make a mistake.'],
  ['Ask them to write down the information.', '忘れないように、書いていただけますか。', 'Wasurenai yō ni, kaite itadakemasu ka.', 'Could you write it down so I do not forget?'],
  ['Check that you have understood correctly.', 'この理解で合っていますか。', 'Kono rikai de atte imasu ka.', 'Have I understood correctly?'],
  ['Thank them specifically for their patient explanation.', '丁寧に説明してくださって、ありがとうございました。', 'Teinei ni setsumei shite kudasatte, arigatō gozaimashita.', 'Thank you for explaining so patiently.'],
] as const;

export function scenarioAtDifficulty(base: Scenario, difficulty: LessonDifficulty): Scenario {
  return { ...base, difficulty, questions: base.questions.map((question, index) => {
    if (difficulty === 'easy') return { ...question, difficulty };
    const [task, japanese, reading, meaning] = challenges[index % challenges.length];
    const { options: _options, correctIndex: _correctIndex, ...original } = question;
    return { ...original, difficulty, kind: 'roleplay' as const,
      japanese: `${question.japanese} 続けて、次の課題にも答えてください。`,
      meaning: `${question.meaning} Then complete the extra speaking task.`,
      task: `${question.options ? `Respond naturally with this meaning: “${question.answerMeaning}”.` : question.task} Then: ${task} Use a complete, polite response; both parts matter.`,
      modelAnswer: `${question.modelAnswer} ${japanese}`,
      reading: `${question.reading} ${reading}`,
      answerMeaning: `${question.answerMeaning} ${meaning}`,
      tip: `${question.tip} Practise the additional polite expression and connect both parts of your reply.`,
    };
  }) };
}

export function speechInstruction(question: Question): string {
  if (question.id === levelQuestion.id) return `Ask briefly in ENGLISH only: "${levelQuestion.meaning}" Say they can answer easy or difficult, or use the buttons. Wait for the app to confirm their choice. Do not translate this setup question into Japanese, choose for them, teach a lesson question or assess the preference. If unclear, ask them in English to choose one level.`;
  const context = `The app has confirmed ${question.difficulty ?? 'easy'} difficulty. Coach in ENGLISH; only the practice phrase is Japanese. Stay on this question until the app advances it.`;
  if (question.options) return `${context} Ask this English quiz task: "${question.task}" Read the Japanese line once: "${question.japanese}" Ask them to choose an answer on screen, then STOP and wait. Do not reveal the line's translation, correct option or model answer.`;
  if (question.difficulty === 'difficult') return `${context} Explain this task briefly in English: "${question.task}" Ask for a complete, polite Japanese reply covering both parts, then STOP and wait. Do not explain the task in Japanese or reveal the model answer before an attempt. If they request help, give one short English hint and one relevant Japanese example.`;
  return `${context} Briefly explain the situation in English: "${question.meaning}" The learner needs to: "${question.task}" Say "Try saying", then model this Japanese reply slowly ONCE: "${question.modelAnswer}". Its English meaning is "${question.answerMeaning}". Invite "Your turn — say it in Japanese", then STOP and wait. Keep the English explanation to one or two short sentences. Do not read romanization, add extra Japanese dialogue or repeat the example unless asked.`;
}
