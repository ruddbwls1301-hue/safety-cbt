import { describe, expect, it } from 'vitest';
import type { Question } from '../types';
import { BOOK_SUBJECTS, SUBJECTS } from '../constants';
import { BOOK_EXAM_ROUNDS, PRACTICE_BATCH_SIZE, bookRoundKey, bookRoundLabel, practiceBatchCount, selectBookRound, selectPracticeBatch, selectPracticePool } from './bookSelection';
import { canonicalSubjectLabel, parseQuestionBackup, parseQuestionImport, subjectFor } from './questions';
import { autoApproveBookQuestions, convertBookData, isBookQuestionEligible, stableBookQuestionId } from './bookData';

function fixture(id: string, sourceOrder = 0, originalNumber = 1): Question {
  return {
    id: stableBookQuestionId(id), year: 2022, round: '실전 3회차', originalSubject: BOOK_SUBJECTS[0],
    prompt: '가져오기 검증용 지문', choices: ['선택 가', '선택 나', '선택 다', '선택 라'], answer: 2,
    explanation: '검증용 해설', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
    book: {
      datasetId: 'industrial-safety-cbt-book', originalId: id, originalNumber, sourceOrder, section: 'exam',
      subjectNo: 1, sourceSubject: '이전 표기', examRound: { year: 2022, round: 3 }, frequency: null,
      answerSource: '검증용 출처', reviewFlags: [], source: { page: 1, spans: [{ page: 1, column: 'L', y0: 0.1, y1: 0.5 }] }, explanationRef: null,
      questionHasImage: false, choicesAreImages: false, textVerified: true,
      reviewImageId: `review-${id}`, review: { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: false },
      issues: [], rawRecord: { validationOnly: true },
    },
  };
}

function chapterFixture(subjectNo: number, index: number) {
  const id = `validation-chapter-${subjectNo}-${index}`;
  return {
    id, section: subjectNo, subjectNo, subject: BOOK_SUBJECTS[subjectNo - 1], examRound: null, no: index + 1, frequency: 1,
    question: '과목별 출제 범위 검증용 지문', choices: ['선택 가', '선택 나', '선택 다', '선택 라'], answer: 2,
    answerSource: 'ocr', explanation: '출제 범위 검증용 해설', explanationRef: null, image: `images/${id}.jpg`,
    questionHasImage: false, choicesAreImages: false, textVerified: false,
    source: { page: 1, spans: [{ page: 1, column: 'L', y0: 0.1, y1: 0.5 }] }, reviewFlags: ['choices_markers_inferred'],
  };
}

describe('subject compatibility', () => {
  it('groups old stored spellings with the six book display subjects without rewriting them', () => {
    const oldNames = ['기계·기구 및 설비 안전 관리', '전기설비 안전 관리', '화학설비 안전 관리', '건설공사 안전 관리'];
    oldNames.forEach((oldName, index) => {
      const question = { ...fixture(`alias-${index}`), book: undefined, originalSubject: oldName };
      expect(canonicalSubjectLabel(oldName)).toBe(BOOK_SUBJECTS[index + 2]);
      expect(subjectFor(question, 'legacy')).toBe(BOOK_SUBJECTS[index + 2]);
      expect(question.originalSubject).toBe(oldName);
    });
    expect(SUBJECTS.legacy).toEqual([...BOOK_SUBJECTS]);
  });

  it('uses subjectNo for book questions and never infers a revised subject', () => {
    const question = fixture('subject-number');
    question.book!.subjectNo = 4;
    question.originalSubject = BOOK_SUBJECTS[0];
    expect(subjectFor(question, 'legacy')).toBe('전기설비 안전관리');
    expect(subjectFor(question, 'revised')).toBeUndefined();
    question.currentSubject = '전기 및 화학설비 안전 관리';
    expect(subjectFor(question, 'revised')).toBe('전기 및 화학설비 안전관리');
  });

  it('keeps an automatically approved yearless chapter available under its canonical legacy subject', () => {
    const converted = convertBookData({ questions: [{
      id: 'validation-chapter', section: 1, subjectNo: 1, subject: BOOK_SUBJECTS[0], examRound: null,
      no: 1, frequency: 1, question: '과목별 학습 연결 검증용 지문', choices: ['선택 가', '선택 나', '선택 다', '선택 라'],
      answer: 2, answerSource: 'ocr', explanation: '연결 검증용 해설', explanationRef: null,
      image: 'images/validation-chapter.jpg', questionHasImage: false, choicesAreImages: false, textVerified: false,
      source: { page: 1, spans: [{ page: 1, column: 'L', y0: 0.1, y1: 0.5 }] }, reviewFlags: ['choices_markers_inferred'],
    }] });
    const approved = autoApproveBookQuestions(converted, 'a'.repeat(64));
    expect(approved.approved).toHaveLength(1);
    const question = approved.approved[0];
    expect(question.year).toBeNull();
    expect(question.book!.section).toBe(1);
    expect(isBookQuestionEligible(question, approved.questions)).toBe(true);
    expect(subjectFor(question, 'legacy')).toBe(SUBJECTS.legacy[0]);
    expect(question.book!.review.sourceCompared).toBe(false);
    expect(subjectFor(question, 'revised')).toBeUndefined();
  });
});

describe('book round selection', () => {
  it('offers exactly the three book rounds with their stated counts', () => {
    expect(BOOK_EXAM_ROUNDS.map((round) => [bookRoundKey(round), bookRoundLabel(round), round.count])).toEqual([
      ['2025:1', '2025년 실전 1회차', 115], ['2024:2', '2024년 실전 2회차', 117], ['2022:3', '2022년 실전 3회차', 119],
    ]);
  });

  it('selects the 2022 practice round in source order while retaining number gaps and blocking unreviewed questions', () => {
    const later = fixture('later', 2, 7);
    const earlier = fixture('earlier', 1, 3);
    const pending = { ...fixture('pending', 0, 1), status: 'pending' as const };
    const unchecked = fixture('unchecked', 3, 9);
    unchecked.book!.review.sourceCompared = false;
    const otherRound = fixture('other', 4, 10);
    otherRound.book!.examRound = { year: 2025, round: 1 };
    otherRound.year = 2025;
    const questions = [later, pending, otherRound, unchecked, earlier];
    const selected = selectBookRound(questions, '2022:3');
    expect(selected.map((question) => question.book!.originalId)).toEqual(['earlier', 'later']);
    expect(selected.map((question) => question.book!.originalNumber)).toEqual([3, 7]);
    expect(questions.map((question) => question.book!.originalId)).toEqual(['later', 'pending', 'other', 'unchecked', 'earlier']);
    expect(selectBookRound(questions, '2022:1')).toEqual([]);
  });
});

describe('practice pool selection', () => {
  it('retains all six yearless chapter pools and keeps book exams, pending rows, and unknown subjects outside them', () => {
    const counts = [2, 3, 1, 4, 2, 1];
    const rows = counts.flatMap((count, subjectIndex) => Array.from({ length: count }, (_, index) => chapterFixture(subjectIndex + 1, index)));
    const chapters = autoApproveBookQuestions(convertBookData({ questions: rows }), 'a'.repeat(64)).questions;
    const pending = { ...chapters[0], id: 'pending-selection-only', status: 'pending' as const };
    const unknown = { ...fixture('unknown'), book: undefined, year: 2024, originalSubject: '미확인 과목' };
    const bank = [...chapters, pending, unknown, fixture('separate-book-exam')];
    expect(SUBJECTS.legacy.map((subject) => selectPracticePool(bank, { scheme: 'legacy', mode: 'subject', subject }).length)).toEqual(counts);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'random' })).toHaveLength(counts.reduce((sum, count) => sum + count, 0));
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'random', official: true })).toEqual([]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'round', year: 'all' })).toEqual([]);
    expect(selectPracticePool(bank, { scheme: 'revised', mode: 'random' })).toEqual([]);
    expect(chapters.every((question) => question.year === null && question.book!.review.sourceCompared === false)).toBe(true);
  });

  it('matches a changed subject through its saved alias and never substitutes another subject when the selection is empty', () => {
    const saved = { ...fixture('saved-alias'), book: undefined, year: 2025, originalSubject: '기계·기구 및 설비 안전 관리' };
    const different = { ...fixture('different-subject'), book: undefined, year: 2025, originalSubject: SUBJECTS.legacy[0] };
    const bank = [different, saved];
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'subject', subject: '기계·기구 및 설비 안전 관리' })).toEqual([saved]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'subject', subject: SUBJECTS.legacy[2] })).toEqual([saved]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'subject', subject: SUBJECTS.legacy[5] })).toEqual([]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'subject', subject: '존재하지 않는 과목' })).toEqual([]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'subject' })).toEqual([]);
    expect(saved.originalSubject).toBe('기계·기구 및 설비 안전 관리');
  });

  it('filters ordinary rounds explicitly while retaining old and book questions for requested wrong or bookmarked reviews', () => {
    const year2025 = { ...fixture('ordinary-2025'), book: undefined, year: 2025, round: '2회' };
    const year2024 = { ...fixture('ordinary-2024'), book: undefined, year: 2024, round: '1회' };
    const year2022 = { ...fixture('ordinary-2022'), book: undefined, year: 2022, round: '3회' };
    const bookExam = fixture('review-book-exam');
    const bank = [year2025, year2024, year2022, bookExam];
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'round', year: '2025', round: '2회' })).toEqual([year2025]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'round', year: 'all', round: '1회' })).toEqual([year2024]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'round', year: 'invalid' })).toEqual([]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'wrong', wrongIds: [year2022.id, bookExam.id] })).toEqual([year2022, bookExam]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'bookmarked', bookmarkedIds: [bookExam.id] })).toEqual([bookExam]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'wrong' })).toEqual([]);
    expect(selectPracticePool(bank, { scheme: 'legacy', mode: 'bookmarked' })).toEqual([]);
  });
});

describe('20-question practice batches', () => {
  it('partitions every available question exactly once and retains the final remainder', () => {
    expect(PRACTICE_BATCH_SIZE).toBe(20);
    for (const count of [0, 1, 19, 20, 21, 39, 40, 41, 115, 117, 119, 310]) {
      const ordered = Array.from({ length: count }, (_, index) => fixture(`batch-${count}-${index}`, index + 5, index * 2 + 1));
      const pool = [...ordered].reverse();
      const batchCount = practiceBatchCount(pool);
      const batches = Array.from({ length: batchCount }, (_, index) => selectPracticeBatch(pool, index));
      const combined = batches.flat();
      expect(batchCount).toBe(Math.ceil(count / 20));
      expect(batches.every((batch) => batch.length > 0 && batch.length <= 20)).toBe(true);
      if (count) expect(batches.at(-1)).toHaveLength(count % 20 || 20);
      expect(combined).toEqual(ordered);
      expect(new Set(combined.map((question) => question.id)).size).toBe(count);
      expect(combined.map((question) => question.book!.originalNumber)).toEqual(ordered.map((question) => question.book!.originalNumber));
      expect(pool).toEqual([...ordered].reverse());
    }
  });

  it('returns an empty batch for invalid indices without falling back to another selection', () => {
    const pool = Array.from({ length: 21 }, (_, index) => fixture(`invalid-index-${index}`, index));
    for (const index of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2, Number.MAX_SAFE_INTEGER + 1]) {
      expect(selectPracticeBatch(pool, index)).toEqual([]);
    }
    expect(selectPracticeBatch([], 0)).toEqual([]);
    expect(selectPracticeBatch(pool, 1)).toHaveLength(1);
  });

  it('keeps ordinary pool order and prevents repeated IDs across book and ordinary batches', () => {
    const ordinary = Array.from({ length: 21 }, (_, index) => ({ ...fixture(`ordinary-batch-${20 - index}`), book: undefined }));
    const bookLater = fixture('book-later', 9, 17);
    const bookEarlier = fixture('book-earlier', 2, 3);
    const pool = [ordinary[0], bookLater, ...ordinary.slice(1), bookEarlier, bookLater, ordinary[1]];
    expect(practiceBatchCount(pool)).toBe(2);
    const combined = [selectPracticeBatch(pool, 0), selectPracticeBatch(pool, 1)].flat();
    expect(combined).toEqual([bookEarlier, bookLater, ...ordinary]);
    expect(new Set(combined.map((question) => question.id)).size).toBe(23);
    expect(bookEarlier.book!.originalNumber).toBe(3);
    expect(bookLater.book!.originalNumber).toBe(17);
  });

  it('only partitions the eligible selection and never mutates or approves pending questions', () => {
    const approved = Array.from({ length: 21 }, (_, index) => fixture(`reviewed-batch-${index}`, index, index + 1));
    const pending = { ...fixture('pending-batch', 1, 8), status: 'pending' as const };
    const unchecked = fixture('unchecked-batch', 2, 9);
    unchecked.book!.review.sourceCompared = false;
    const bank = [pending, ...approved, unchecked];
    const before = structuredClone(bank);
    const eligible = selectBookRound(bank, '2022:3');
    expect(practiceBatchCount(eligible)).toBe(2);
    expect([selectPracticeBatch(eligible, 0), selectPracticeBatch(eligible, 1)].flat()).toEqual(approved);
    expect(bank).toEqual(before);
    expect(pending.status).toBe('pending');
    expect(unchecked.book!.review.sourceCompared).toBe(false);
  });
});

describe('question backup compatibility', () => {
  it('preserves nullable answers, blank pending choices, book source metadata, and PDF links', () => {
    const question = fixture('pending-backup');
    question.status = 'pending';
    question.year = null;
    question.answer = null;
    question.choices = ['', '검증용 보기', '', ''];
    question.sourceDocumentId = 'kept-pdf-link';
    question.book!.bookNote = '검증용 도서 메모';
    question.book!.rawRecord = { original: { retained: true } };
    const [restored] = parseQuestionBackup({ questionBank: [question] });
    expect(restored).toEqual(question);
    expect(restored.book!.rawRecord).toEqual({ original: { retained: true } });
  });

  it('keeps approved ordinary questions and their original spelling while accepting aliases in strict imports', () => {
    const old = { ...fixture('old-backup'), book: undefined, originalSubject: '전기설비 안전 관리', sourceDocumentId: 'pdf-old' };
    expect(parseQuestionBackup([old])[0]).toEqual(old);
    const [imported] = parseQuestionImport([old]);
    expect(imported.originalSubject).toBe(old.originalSubject);
    expect(imported.sourceDocumentId).toBe('pdf-old');
    expect(() => parseQuestionImport([{ ...old, answer: null, choices: ['', '', '', ''] }])).toThrow();
  });

  it('downgrades incomplete book metadata and rejects ambiguous duplicate IDs or invalid answers', () => {
    const incomplete = fixture('incomplete');
    incomplete.book!.originalNumber = null;
    const [restored] = parseQuestionBackup([incomplete]);
    expect(restored.status).toBe('pending');
    expect(restored.book!.originalNumber).toBeNull();
    expect(parseQuestionBackup([])).toEqual([]);
    expect(() => parseQuestionBackup([fixture('same'), fixture('same')])).toThrow('중복 문항 ID');
    expect(() => parseQuestionBackup([{ ...fixture('invalid-answer'), answer: 5 }])).toThrow('정답');
  });
});
