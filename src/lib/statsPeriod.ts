import type { Attempt, Question, SchemeId } from '../types';
import { subjectFor } from './questions';

export type StatsPeriod = '7d' | '30d' | 'all';
export const STATS_PERIODS: { value: StatsPeriod; label: string; days: number | null }[] = [
  { value: '7d', label: '최근 7일', days: 7 },
  { value: '30d', label: '최근 30일', days: 30 },
  { value: 'all', label: '전체', days: null },
];

/** Q-Net 과락 기준: 과목 점수 40점 미만. */
export const SUBJECT_FAIL_PERCENT = 40;

/** Submitted attempts whose submission time falls inside the period ending at `now`. */
export function attemptsInPeriod(attempts: readonly Attempt[], period: StatsPeriod, now: number): Attempt[] {
  const days = STATS_PERIODS.find((item) => item.value === period)?.days ?? null;
  if (days === null) return [...attempts];
  const since = now - days * 86_400_000;
  return attempts.filter((attempt) => {
    const at = Date.parse(attempt.submittedAt);
    return Number.isFinite(at) && at >= since && at <= now;
  });
}

export type SubjectAccuracy = { subject: string; count: number; correct: number; percent: number; failing: boolean };

/**
 * Per-subject accuracy over the given attempts. Only attempts of the same scheme count, and only answered
 * questions that still exist in the bank. `failing` marks a subject with answers whose accuracy is under 40%.
 */
export function subjectAccuracy(questions: readonly Question[], attempts: readonly Attempt[], scheme: SchemeId, subjects: readonly string[]): SubjectAccuracy[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const totals = new Map(subjects.map((subject) => [subject, { count: 0, correct: 0 }]));
  for (const attempt of attempts) {
    if (attempt.scheme !== scheme) continue;
    for (const [id, answer] of Object.entries(attempt.answers)) {
      const question = byId.get(id);
      const subject = question ? subjectFor(question, scheme) : undefined;
      const bucket = subject ? totals.get(subject) : undefined;
      if (!question || !bucket) continue;
      bucket.count++;
      if (question.answer === answer) bucket.correct++;
    }
  }
  return subjects.map((subject) => {
    const { count, correct } = totals.get(subject)!;
    // Floor so the shown percent never rounds a sub-40 score up to 40 next to a 과락 warning.
    const percent = count ? Math.floor(correct / count * 100) : 0;
    return { subject, count, correct, percent, failing: count > 0 && percent < SUBJECT_FAIL_PERCENT };
  });
}
