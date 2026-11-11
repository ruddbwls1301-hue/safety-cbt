import { describe, expect, it } from 'vitest';
import type { ActiveSession, Question, SessionMode } from '../types';
import { assignPracticeAnswer, checkPracticeAnswer, supportsPracticeFeedback } from './practiceFeedback';

// Synthetic unit fixtures only; these are never added to the question bank.
function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'unit-feedback-question', year: null, round: '', originalSubject: '검증용 과목',
    prompt: '정답 확인 동작 검증용 지문', choices: ['검증 가', '검증 나', '검증 다', '검증 라'],
    answer: 2, explanation: '정답 확인 검증용 해설', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'unit-feedback-session', title: '검증용 연습', scheme: 'legacy', mode: 'subject',
    questionIds: ['unit-feedback-question', 'unit-other-question'], answers: {}, markedIds: [],
    index: 0, startedAt: '2026-01-01T00:00:00.000Z', deadlineAt: 1_800_000,
    ...overrides,
  };
}

describe('practice feedback compatibility', () => {
  it('supports every existing practice mode without requiring a stored-data migration', () => {
    const modes: SessionMode[] = ['random', 'subject', 'round', 'wrong', 'bookmarked', 'book-round'];
    modes.forEach((mode) => expect(supportsPracticeFeedback(session({ mode }))).toBe(true));
    expect(supportsPracticeFeedback(session({ title: '전체 무작위 정식 모의고사' }))).toBe(false);
  });

  it('uses the explicit flag for new sessions, independently of their title', () => {
    expect(supportsPracticeFeedback(session({ feedbackEnabled: false }))).toBe(false);
    expect(supportsPracticeFeedback(session({ feedbackEnabled: true, title: '전체 무작위 정식 모의고사' }))).toBe(true);
  });
});

describe('immediate answer checks', () => {
  it('records only the checked ID and preserves the selected wrong answer for final grading', () => {
    const original = session({ answers: { 'unit-feedback-question': 1 }, checkedQuestionIds: ['unit-other-question'] });
    const result = checkPracticeAnswer(original, question());
    expect(result).not.toBe(original);
    expect(result.checkedQuestionIds).toEqual(['unit-other-question', 'unit-feedback-question']);
    expect(result.answers).toBe(original.answers);
    expect(result.answers['unit-feedback-question']).toBe(1);
    expect(original.checkedQuestionIds).toEqual(['unit-other-question']);
    expect(result.questionIds).toBe(original.questionIds);
    expect(result.markedIds).toBe(original.markedIds);
    expect(result.index).toBe(original.index);
    expect(result.deadlineAt).toBe(original.deadlineAt);
  });

  it('initializes missing checked IDs and does not add a second check after restoring a session', () => {
    const original = session({ answers: { 'unit-feedback-question': 2 } });
    const checked = checkPracticeAnswer(original, question());
    expect(checked.checkedQuestionIds).toEqual(['unit-feedback-question']);
    expect(original.checkedQuestionIds).toBeUndefined();
    const restored: ActiveSession = JSON.parse(JSON.stringify(checked));
    expect(checkPracticeAnswer(restored, question())).toBe(restored);
    expect(assignPracticeAnswer(restored, question().id, 3)).toBe(restored);
  });

  it('does not reveal unanswered questions, questions outside the session, or disabled feedback', () => {
    const unanswered = session();
    expect(checkPracticeAnswer(unanswered, question())).toBe(unanswered);
    const disabled = session({ feedbackEnabled: false, answers: { 'unit-feedback-question': 2 } });
    expect(checkPracticeAnswer(disabled, question())).toBe(disabled);
    const official = session({ title: '전체 무작위 정식 모의고사', answers: { 'unit-feedback-question': 2 } });
    expect(checkPracticeAnswer(official, question())).toBe(official);
    const outside = session({ questionIds: ['unit-other-question'], answers: { 'unit-feedback-question': 2 } });
    expect(checkPracticeAnswer(outside, question())).toBe(outside);
  });

  it('never guesses a missing or invalid correct answer', () => {
    const original = session({ answers: { 'unit-feedback-question': 2 } });
    for (const answer of [null, 0, 5, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(checkPracticeAnswer(original, question({ answer }))).toBe(original);
    }
  });

  it('requires a valid selected choice and allows all four valid choice numbers', () => {
    for (const answer of [0, 5, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const original = session({ answers: { 'unit-feedback-question': answer } });
      expect(checkPracticeAnswer(original, question())).toBe(original);
    }
    for (const answer of [1, 2, 3, 4]) {
      const original = session({ answers: { 'unit-feedback-question': answer } });
      expect(checkPracticeAnswer(original, question({ answer })).checkedQuestionIds).toEqual(['unit-feedback-question']);
    }
  });
});

describe('practice answer selection', () => {
  it('allows changing choices before checking without mutating existing answers', () => {
    const original = session({ answers: { 'unit-other-question': 4 } });
    const first = assignPracticeAnswer(original, question().id, 1);
    const changed = assignPracticeAnswer(first, question().id, 3);
    expect(original.answers).toEqual({ 'unit-other-question': 4 });
    expect(first.answers).toEqual({ 'unit-other-question': 4, 'unit-feedback-question': 1 });
    expect(changed.answers).toEqual({ 'unit-other-question': 4, 'unit-feedback-question': 3 });
    expect(changed.questionIds).toBe(original.questionIds);
    expect(changed.markedIds).toBe(original.markedIds);
    expect(assignPracticeAnswer(changed, question().id, 3)).toBe(changed);
  });

  it('locks the first checked response so later changes cannot inflate the final score', () => {
    const answered = assignPracticeAnswer(session(), question().id, 1);
    const checked = checkPracticeAnswer(answered, question());
    expect(assignPracticeAnswer(checked, question().id, 2)).toBe(checked);
    expect(checked.answers[question().id]).toBe(1);
    expect(assignPracticeAnswer(checked, 'unit-other-question', 4).answers['unit-other-question']).toBe(4);
  });

  it('rejects outside IDs and invalid choices while retaining formal exam answer changes', () => {
    const original = session();
    expect(assignPracticeAnswer(original, 'outside-question', 2)).toBe(original);
    for (const answer of [0, 5, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(assignPracticeAnswer(original, question().id, answer)).toBe(original);
    }
    const official = session({ feedbackEnabled: false, answers: { 'unit-feedback-question': 1 }, checkedQuestionIds: ['unit-feedback-question'] });
    expect(assignPracticeAnswer(official, question().id, 2).answers[question().id]).toBe(2);
  });
});
