import { describe, expect, it } from 'vitest';
import { SYMBOL_GROUPS, insertAtSelection, isHumanCompared, needsSymbolReview, symbolHints } from './symbolReview';
import { autoApproveBookQuestions, convertBookData, isBookQuestionEligible } from './bookData';
import { bookReviewIssueMatches } from './bookReview';
import type { Question } from '../types';

// Synthetic fixtures only; modelled on the reported screen, never read from the real bank.
const PROCESS = ['○', '⇒', '□', '◇', '▽', 'D'];
function plain(overrides: Partial<Question> = {}): Question {
  return {
    id: 'unit-symbol', year: null, round: '', originalSubject: '인간공학 및 위험성 평가·관리',
    prompt: '합성 지문: 공정도에서 기호와 의미가 잘못 연결된 것은?', choices: ['□ : 지체', '▽ : 저장', '⇒ : 운반', '○ : 가공'],
    answer: 1, explanation: '합성 해설: 지체는 D, 수량검사는 □, 품질검사는 ◇ 이다.', status: 'pending', createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}
function bookRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'unit-symbol-book', section: 2, subjectNo: 2, subject: '인간공학 및 위험성 평가·관리', no: 237, frequency: 1, examRound: null,
    question: '합성 지문: 공정도에서 기호와 의미가 잘못 연결된 것은?', choices: ['0 : 지체', 'V : 저장', '5: 운반', '0: 가공'], answer: 1,
    answerSource: 'ocr', explanation: '합성 해설입니다.', explanationRef: null, image: 'images/unit-symbol-book.jpg',
    source: { page: 2, spans: [{ page: 2, column: 'L', y0: 0.1, y1: 0.5 }] }, questionHasImage: false, choicesAreImages: false, textVerified: false, reviewFlags: [], ...overrides,
  };
}

describe('symbol palette data', () => {
  it('offers the six process-chart symbols exactly as the reference standard defines them', () => {
    const process = SYMBOL_GROUPS.find((group) => group.id === 'process')!;
    expect(process.symbols.map((symbol) => symbol.char)).toEqual(PROCESS);
    expect(process.symbols.map((symbol) => symbol.name)).toEqual(['가공', '운반', '수량검사', '품질검사', '저장', '지체']);
  });
  it('has no duplicate or empty symbols within a group', () => {
    for (const group of SYMBOL_GROUPS) {
      const chars = group.symbols.map((symbol) => symbol.char);
      expect(chars.every(Boolean)).toBe(true);
      expect(new Set(chars).size).toBe(chars.length);
    }
  });
});

describe('caret insertion', () => {
  it('inserts at the caret without touching other characters', () => {
    expect(insertAtSelection(' : 지체', 0, 0, '□')).toEqual({ value: '□ : 지체', caret: 1 });
    expect(insertAtSelection('가 나', 1, 1, '⇒')).toEqual({ value: '가⇒ 나', caret: 2 });
  });
  it('replaces only the range the person selected', () => {
    expect(insertAtSelection('0 : 지체', 0, 1, '□')).toEqual({ value: '□ : 지체', caret: 1 });
  });
  it('appends when there is no caret and clamps out-of-range positions', () => {
    expect(insertAtSelection('저장', null, null, '▽')).toEqual({ value: '저장▽', caret: 3 });
    expect(insertAtSelection('저장', 99, 120, '▽')).toEqual({ value: '저장▽', caret: 3 });
  });
});

describe('review hints never rewrite text', () => {
  it('flags single digit/letter choice heads like the reported screen', () => {
    const question = plain({ choices: ['0 : 지체', 'V : 저장', '5: 운반', '0: 가공'] });
    const before = structuredClone(question);
    const hints = symbolHints(question);
    expect(hints.filter((hint) => hint.field === 'choice').map((hint) => hint.index)).toEqual([0, 1, 2, 3]);
    expect(hints.some((hint) => hint.field === 'prompt' && hint.reason.includes('기호 문자가 없습니다'))).toBe(true);
    expect(question).toEqual(before);
  });
  it('keeps the source letter D as a hint only and stays quiet for symbol heads', () => {
    expect(symbolHints(plain())).toEqual([]);
    const withD = symbolHints(plain({ choices: ['D : 지체', '▽ : 저장', '⇒ : 운반', '○ : 가공'] }));
    expect(withD).toHaveLength(1);
    expect(withD[0].reason).toContain('그대로 둡니다');
  });
  it('points at broken characters, lost exponents, gaps and empty heads', () => {
    const reasons = (text: string) => symbolHints(plain({ prompt: '합성 지문', choices: ['가', '나', '다', '라'], explanation: text })).map((hint) => hint.reason).join(' ');
    expect(reasons('합성 � 문자')).toContain('깨진 문자');
    expect(reasons('압력 5 kg/cm2 이상')).toContain('지수');
    expect(reasons('고장률 10-3 /시간')).toContain('10⁻ⁿ');
    expect(reasons('앞    뒤')).toContain('공백');
    expect(reasons('합성 5 ㎏/㎠ 이상, 10⁻³')).toBe('');
    expect(symbolHints(plain({ choices: [': 지체', '▽ : 저장', '⇒ : 운반', '○ : 가공'] }))[0].reason).toContain('앞머리 기호가 빠졌을 수');
  });
  it('does not flag lettered blanks or ratios', () => {
    expect(symbolHints(plain({ prompt: '합성 지문', choices: ['A: 75, B: 30', 'A: 근막, B: 액틴, C: 마이오신', '1:0.5~1', '1:1.8'] }))).toEqual([]);
  });
  it('tolerates malformed backup rows', () => {
    expect(symbolHints({ prompt: undefined, choices: undefined, explanation: undefined } as unknown as Question)).toEqual([]);
  });
});

describe('review status', () => {
  it('lists hinted content until a person verifies it, and never lists human-verified content', () => {
    const suspicious = plain({ choices: ['0 : 지체', 'V : 저장', '5: 운반', '0: 가공'] });
    expect(needsSymbolReview(suspicious)).toBe(true);
    expect(needsSymbolReview({ ...suspicious, status: 'verified' })).toBe(false);
    expect(needsSymbolReview(plain())).toBe(false);
  });
  it('does not treat automatic structure approval as a human source comparison', () => {
    const [converted] = convertBookData({ questions: [bookRow()] });
    const { questions: [auto] } = autoApproveBookQuestions([converted], 'a'.repeat(64));
    expect(auto.status).toBe('verified');
    expect(isBookQuestionEligible(auto, [auto])).toBe(true);
    expect(isHumanCompared(auto)).toBe(false);
    expect(needsSymbolReview(auto)).toBe(true);
    expect(bookReviewIssueMatches(auto, 'symbol')).toBe(true);
  });
  it('drops an automatically approved question out of the exam pool once its text is corrected', () => {
    const [converted] = convertBookData({ questions: [bookRow()] });
    const { questions: [auto] } = autoApproveBookQuestions([converted], 'a'.repeat(64));
    // Even if a stale "verified" status and automatic stamp survived, edited text is not eligible.
    const corrected: Question = { ...auto, choices: ['□ : 지체', '▽ : 저장', '⇒ : 운반', '○ : 가공'] };
    expect(corrected.id).toBe(auto.id);
    expect(isBookQuestionEligible(corrected, [corrected])).toBe(false);
    const manual: Question = { ...corrected, book: { ...corrected.book!, review: { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: false } } };
    expect(isBookQuestionEligible(manual, [manual])).toBe(true);
    expect(isHumanCompared(manual)).toBe(true);
    expect(needsSymbolReview(manual)).toBe(false);
  });
});
