import type { Attempt, Question } from '../types';

export type ReviewState = 'wrong' | 'unanswered';
/** A question leaves the review list after this many correct submissions in a row. */
export const REVIEW_GRADUATION_STREAK = 2;
export type ReviewEntry = { questionId: string; state: ReviewState; correctStreak: number };

/**
 * Review queue from submitted history.
 * - A wrong or unanswered submission puts the question in the queue (or resets its streak).
 * - While queued, each correct submission adds one to the streak; at REVIEW_GRADUATION_STREAK it leaves.
 * - A question that was never wrong or unanswered is never queued.
 * History is stored newest first; submissions with the same timestamp keep that order (later index = older).
 * Output follows the order in which questions first entered the history, independent of the input order.
 */
export function reviewQueue(attempts: readonly Attempt[], questions: readonly Question[]): ReviewEntry[] {
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const events: { at: number; order: number; id: string; outcome: ReviewState | 'correct' }[] = [];
  attempts.forEach((attempt, index) => {
    const at = new Date(attempt.submittedAt).getTime();
    for (const id of new Set(attempt.questionIds)) {
      const question = questionById.get(id);
      if (!question) continue;
      const answer = attempt.answers[id];
      events.push({ at, order: index, id, outcome: answer === undefined ? 'unanswered' : answer === question.answer ? 'correct' : 'wrong' });
    }
  });
  events.sort((a, b) => a.at - b.at || b.order - a.order);
  const progress = new Map<string, { queued: boolean; state: ReviewState; streak: number }>();
  for (const event of events) {
    const current = progress.get(event.id) ?? { queued: false, state: 'wrong' as ReviewState, streak: 0 };
    if (event.outcome !== 'correct') progress.set(event.id, { queued: true, state: event.outcome, streak: 0 });
    else if (current.queued) {
      const streak = current.streak + 1;
      progress.set(event.id, streak >= REVIEW_GRADUATION_STREAK ? { queued: false, state: current.state, streak: 0 } : { ...current, streak });
    } else progress.set(event.id, current);
  }
  return [...progress].flatMap(([questionId, entry]) => entry.queued ? [{ questionId, state: entry.state, correctStreak: entry.streak }] : []);
}
