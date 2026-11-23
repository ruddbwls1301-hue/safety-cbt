import { describe, expect, it } from 'vitest';
import { attemptsInPeriod, subjectAccuracy } from './statsPeriod';
import type { Attempt, Question } from '../types';

// Synthetic fixtures only.
const NOW = Date.parse('2026-11-23T12:00:00.000Z');
const day = 86_400_000;
function attempt(id: string, daysAgo: number, answers: Record<string, number>, scheme: Attempt['scheme'] = 'legacy'): Attempt {
  return { id, title: id, scheme, mode: 'subject', questionIds: Object.keys(answers), answers, startedAt: new Date(NOW - daysAgo * day - 60_000).toISOString(), submittedAt: new Date(NOW - daysAgo * day).toISOString(), remainingSeconds: 0 };
}
function question(id: string, subject: string, answer = 1): Question {
  return { id, year: null, round: '', originalSubject: subject, prompt: id, choices: ['1', '2', '3', '4'], answer, explanation: '', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z' };
}

describe('stats period', () => {
  it('keeps attempts submitted within the period, inclusive of the boundary', () => {
    const list = [attempt('a', 1, {}), attempt('b', 7, {}), attempt('c', 8, {}), attempt('d', 29, {}), attempt('e', 31, {})];
    expect(attemptsInPeriod(list, '7d', NOW).map((item) => item.id)).toEqual(['a', 'b']);
    expect(attemptsInPeriod(list, '30d', NOW).map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(attemptsInPeriod(list, 'all', NOW)).toHaveLength(5);
  });

  it('ignores attempts with an unreadable submission time for limited periods', () => {
    expect(attemptsInPeriod([{ ...attempt('x', 1, {}), submittedAt: 'not-a-date' }], '7d', NOW)).toEqual([]);
  });
});

describe('subject accuracy', () => {
  const subjects = ['과목 가', '과목 나', '과목 다'];
  const bank = [question('q1', '과목 가'), question('q2', '과목 가'), question('q3', '과목 가'), question('q4', '과목 가'), question('q5', '과목 가'), question('q6', '과목 나')];

  it('marks a subject under 40% as failing and never rounds it up to 40', () => {
    // 과목 가: 2 of 5 correct = 40% → not failing. 과목 나: 0 of 1 → failing. 과목 다: no answers → not failing.
    const rows = subjectAccuracy(bank, [attempt('a', 1, { q1: 1, q2: 1, q3: 2, q4: 2, q5: 2, q6: 3 })], 'legacy', subjects);
    expect(rows).toEqual([
      { subject: '과목 가', count: 5, correct: 2, percent: 40, failing: false },
      { subject: '과목 나', count: 1, correct: 0, percent: 0, failing: true },
      { subject: '과목 다', count: 0, correct: 0, percent: 0, failing: false },
    ]);
    const borderline = subjectAccuracy([...bank, question('q7', '과목 가')], [attempt('b', 1, { q1: 1, q2: 1, q3: 2, q4: 2, q5: 2, q7: 2 })], 'legacy', subjects)[0];
    expect(borderline).toMatchObject({ count: 6, correct: 2, percent: 33, failing: true });
  });

  it('skips other schemes and questions missing from the bank', () => {
    const rows = subjectAccuracy(bank, [attempt('a', 1, { q1: 1, gone: 1 }), attempt('r', 1, { q2: 2 }, 'revised')], 'legacy', subjects);
    expect(rows[0]).toMatchObject({ count: 1, correct: 1, percent: 100 });
  });
});
