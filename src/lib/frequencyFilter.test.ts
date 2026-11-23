import { describe, expect, it } from 'vitest';
import { bookApprovalIssues, convertBookData, isBookQuestionEligible } from './bookData';
import { FREQUENT_MIN_COUNT, matchesFrequency, selectPracticePool } from './bookSelection';
import type { Question } from '../types';

// Synthetic book rows only (same shape as the converter tests); no real question bank data.
function reviewedBookQuestion(id: string, no: number, frequency: number | null, subjectNo = 1, subject = '산업재해 예방 및 안전보건교육'): Question {
  const question = convertBookData({ questions: [{ id, section: subjectNo, subjectNo, subject, no, frequency, examRound: null, question: `검증용 지문 ${id}`, choices: ['가', '나', '다', '라'], answer: 2, answerSource: 'manual_visual_check', explanation: '검증용 해설', explanationRef: null, image: `images/${id}.jpg`, questionHasImage: false, choicesAreImages: false, textVerified: false, source: { page: 10, spans: [{ page: 10, column: 'L', y0: 0.1, y1: 0.5 }] }, reviewFlags: [] }] })[0];
  question.status = 'verified';
  question.book!.review = { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: false };
  return question;
}
const plain: Question = { id: 'user-added', year: null, round: '', originalSubject: '산업재해 예방 및 안전보건교육', prompt: '직접 입력', choices: ['가', '나', '다', '라'], answer: 1, explanation: '', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z' };

describe('frequency filter', () => {
  it('splits book questions at 3 appearances and never guesses a missing frequency', () => {
    const counts = [0, 1, 2, 3, 4, 12];
    const book = counts.map((frequency, index) => reviewedBookQuestion(`f${frequency}`, index + 1, frequency));
    expect(FREQUENT_MIN_COUNT).toBe(3);
    expect(book.filter((q) => matchesFrequency(q, 'frequent')).map((q) => q.book!.frequency)).toEqual([3, 4, 12]);
    expect(book.filter((q) => matchesFrequency(q, 'rare')).map((q) => q.book!.frequency)).toEqual([0, 1, 2]);
    expect(book.every((q) => matchesFrequency(q, 'all'))).toBe(true);
    expect(matchesFrequency(plain, 'frequent')).toBe(false);
    expect(matchesFrequency(plain, 'rare')).toBe(false);
    expect(matchesFrequency(plain, 'all')).toBe(true);
  });

  it('applies on top of the subject pool without pulling in other subjects', () => {
    const bank = [
      reviewedBookQuestion('a', 1, 5), reviewedBookQuestion('b', 2, 1), reviewedBookQuestion('c', 3, 3),
      reviewedBookQuestion('d', 4, 7, 4, '전기설비 안전관리'),
    ];
    expect(bank.map((q) => bookApprovalIssues(q, bank))).toEqual(bank.map(() => []));
    expect(bank.every((q) => isBookQuestionEligible(q, bank))).toBe(true);
    const pool = selectPracticePool(bank, { scheme: 'legacy', mode: 'subject', subject: '산업재해 예방 및 안전보건교육' });
    expect(pool.filter((q) => matchesFrequency(q, 'frequent')).map((q) => q.book!.originalId)).toEqual(['a', 'c']);
    expect(pool.filter((q) => matchesFrequency(q, 'rare')).map((q) => q.book!.originalId)).toEqual(['b']);
  });
});
