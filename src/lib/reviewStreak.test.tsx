import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Dashboard, QuestionCollection } from '../App';
import { reviewQueue } from './reviewQueue';
import type { Attempt, Question } from '../types';

// Synthetic fixtures only.
function q(id: string, subject = '산업재해 예방 및 안전보건교육'): Question {
  return { id, year: null, round: '', originalSubject: subject, prompt: `지문 ${id}`, choices: ['가', '나', '다', '라'], answer: 2, explanation: '', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z' };
}
function at(day: number, answers: Record<string, number | undefined>): Attempt {
  const ids = Object.keys(answers);
  return { id: `a${day}`, title: 't', scheme: 'legacy', mode: 'wrong', questionIds: ids, answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v !== undefined)) as Record<string, number>, startedAt: `2026-11-${String(day).padStart(2, '0')}T00:00:00.000Z`, submittedAt: `2026-11-${String(day).padStart(2, '0')}T01:00:00.000Z`, remainingSeconds: 0 };
}

describe('review graduation streak', () => {
  const bank = [q('x'), q('y')];
  it('needs two correct submissions in a row; a miss in between resets the streak', () => {
    const history = [at(1, { x: 1 }), at(2, { x: 2 }), at(3, { x: 3 }), at(4, { x: 2 })].reverse();
    expect(reviewQueue(history, bank)).toEqual([{ questionId: 'x', state: 'wrong', correctStreak: 1 }]);
    const graduated = [at(5, { x: 2 }), ...history];
    expect(reviewQueue(graduated, bank)).toEqual([]);
  });
  it('treats unanswered as a miss and never queues questions that were always correct', () => {
    const history = [at(2, { x: 2, y: undefined }), at(1, { x: 2, y: 2 })];
    expect(reviewQueue(history, bank)).toEqual([{ questionId: 'y', state: 'unanswered', correctStreak: 0 }]);
  });
});

describe('start cards and empty review state', () => {
  const noop = () => {};
  const base = { questionCount: 2, pendingCount: 0, stats: { answered: 0, correct: 0, accuracy: 0 }, wrongCount: 0, bookmarks: 0, scheme: 'legacy' as const, setScheme: noop, onExam: noop, onBank: noop, onMistakes: noop, onResume: noop, onHistory: noop };
  it('shows two start cards and recommends the weakest subject once there is history', () => {
    const fresh = renderToStaticMarkup(<Dashboard {...base} questions={[q('x')]} attempts={[]}/>);
    expect(fresh).toContain('과목별로 차근차근');
    expect(fresh).toContain('실전 모의고사로 약점 찾기');
    expect(fresh).toContain('120문항 · 180분');
    expect(fresh).toContain('처음이라면 1과목부터');
    const bank = [q('x'), q('e', '전기설비 안전관리')];
    const withHistory = renderToStaticMarkup(<Dashboard {...base} questions={bank} attempts={[at(1, { x: 2, e: 1 })]}/>);
    expect(withHistory).toContain('추천 과목: 전기설비 안전관리 · 정답률 0%');
  });
  it('offers a next step when the review list is empty', () => {
    const html = renderToStaticMarkup(<QuestionCollection questions={[]} allQuestions={[]} scheme="legacy" onBookmark={noop} bookmarks={[]} onEdit={noop} empty={{ title: '아직 제출한 시험이 없어요', text: '안내', action: '과목별 20문항 풀기' }} onEmptyAction={noop}/>);
    expect(html).toContain('아직 제출한 시험이 없어요');
    expect(html).toContain('과목별 20문항 풀기');
  });
  it('shows the streak badge for a queued question answered correctly once', () => {
    const html = renderToStaticMarkup(<QuestionCollection questions={[q('x')]} allQuestions={[q('x')]} scheme="legacy" onBookmark={noop} bookmarks={[]} onEdit={noop} reviewStates={new Map([['x', 'wrong']])} reviewStreaks={new Map([['x', 1]])}/>);
    expect(html).toContain('연속 정답 1/2');
  });
});
