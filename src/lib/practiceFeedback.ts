import type { ActiveSession, Question } from '../types';

const LEGACY_OFFICIAL_EXAM_TITLE = '전체 무작위 정식 모의고사';

function isChoiceNumber(answer: number | null | undefined): answer is number {
  return Number.isInteger(answer) && answer !== null && answer !== undefined && answer >= 1 && answer <= 4;
}

export function supportsPracticeFeedback(session: ActiveSession): boolean {
  if (typeof session.feedbackEnabled === 'boolean') return session.feedbackEnabled;
  return session.title !== LEGACY_OFFICIAL_EXAM_TITLE;
}

export function checkPracticeAnswer(session: ActiveSession, question: Question): ActiveSession {
  const checkedIds = session.checkedQuestionIds ?? [];
  if (!supportsPracticeFeedback(session)
    || !session.questionIds.includes(question.id)
    || !isChoiceNumber(session.answers[question.id])
    || !isChoiceNumber(question.answer)
    || checkedIds.includes(question.id)) return session;

  return { ...session, checkedQuestionIds: [...checkedIds, question.id] };
}

export function assignPracticeAnswer(session: ActiveSession, questionId: string, answer: number): ActiveSession {
  if (!session.questionIds.includes(questionId)
    || !isChoiceNumber(answer)
    || supportsPracticeFeedback(session) && session.checkedQuestionIds?.includes(questionId)
    || session.answers[questionId] === answer) return session;

  return { ...session, answers: { ...session.answers, [questionId]: answer } };
}
