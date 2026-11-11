import { describe, expect, it } from 'vitest';
import { autoApproveBookQuestions, automaticBookApprovalIssues, bookApprovalIssues, bookQuestionImagePath, bookReviewImagePath, convertBookData, inspectBookData, isBookQuestionEligible, stableBookImageId, stableBookQuestionId } from './bookData';

function row(overrides: Record<string, unknown> = {}) {
  return { id: 'synthetic-1', section: 1, subjectNo: 1, subject: '산업재해 예방 및 안전보건교육', no: 8, frequency: 3, examRound: null, question: '검증용 지문', choices: ['가', '나', '다', '라'], answer: 2, answerSource: 'manual_visual_check', explanation: '검증용 해설', explanationRef: null, image: 'images/synthetic-1.jpg', source: { page: 2, spans: [{ page: 2, column: 'L', y0: 0.1, y1: 0.5 }] }, reviewFlags: [], questionHasImage: false, choicesAreImages: false, textVerified: false, ...overrides };
}
function reviewed(overrides: Record<string, unknown> = {}) {
  const question = convertBookData({ questions: [row(overrides)] })[0];
  question.status = 'verified';
  question.book!.review = { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: false };
  return question;
}

describe('book conversion and approval boundary', () => {
  it('preserves separate new question and explanation image paths without trusting the source safety claim', () => {
    const raw = row({ image: undefined, explanationImage: 'images/synthetic-1.jpg', questionImage: 'images_question/synthetic-1.jpg', questionHasImage: true });
    expect(bookReviewImagePath(raw)).toBe('images/synthetic-1.jpg');
    expect(bookQuestionImagePath(raw)).toBe('images_question/synthetic-1.jpg');
    expect(bookReviewImagePath(row())).toBe('images/synthetic-1.jpg');
    expect(bookQuestionImagePath(row())).toBe('');
    const question = convertBookData({ meta: { images: { questionImage: '정답 없음' } }, questions: [raw] })[0];
    expect(question.book!.reviewImageId).toBe(stableBookImageId('images/synthetic-1.jpg'));
    expect(question.book!.sourceQuestionImageId).toBe(stableBookImageId('images_question/synthetic-1.jpg'));
    expect(question.book!.rawRecord.questionImage).toBe('images_question/synthetic-1.jpg');
    expect(question.book!.examImageId).toBeUndefined();
    expect(question.book!.review.examImageSafe).toBe(false);
    expect(autoApproveBookQuestions([question], 'a'.repeat(64)).approved).toEqual([]);
    const complete = inspectBookData({ questions: [raw] }, ['images/synthetic-1.jpg', 'images_question/synthetic-1.jpg']);
    expect(complete).toMatchObject({ imageCount: 2, questionImageCandidates: 1, missingImages: [] });
    expect(inspectBookData({ questions: [raw] }, ['images/synthetic-1.jpg']).missingImages).toEqual(['images_question/synthetic-1.jpg']);
  });
  it('preserves source IDs, subject numbers, unknown years and printed order without inferring from frequency', () => {
    const input = { questions: [row({ subjectNo: 3, section: 3, subject: '기계·기구 및 설비 안전 관리', no: 324, frequency: 2025, bookNote: '원본 번호 중복' }), row({ id: 'synthetic-2', section: 'exam', examRound: { round: 3, year: 2022 }, no: 119, image: 'images/synthetic-2.jpg' })] };
    const questions = convertBookData(input);
    expect(questions[0]).toMatchObject({ id: stableBookQuestionId('synthetic-1'), year: null, round: '', originalSubject: '기계·기구 및 설비 안전관리', status: 'pending' });
    expect(questions[0].book).toMatchObject({ originalNumber: 324, sourceOrder: 0, frequency: 2025, bookNote: '원본 번호 중복', sourceSubject: '기계·기구 및 설비 안전 관리' });
    expect(questions[1]).toMatchObject({ year: 2022, round: '실전 3회차', status: 'pending' });
    expect(questions[1].book).toMatchObject({ originalNumber: 119, sourceOrder: 1 });
    expect(questions.every((question) => !question.imageDataUrl)).toBe(true);
    expect(convertBookData(input).map((question) => question.id)).toEqual(questions.map((question) => question.id));
  });

  it('detects duplicates, missing images, empty choices and invalid references without repairing them', () => {
    const rows = [row({ choices: ['', '나', '다', '라'], reviewFlags: ['formula_check_image'], explanationRef: 'missing' }), row({ id: 'synthetic-2', explanationRef: 'synthetic-3' }), row({ id: 'synthetic-3', explanationRef: 'synthetic-2' })];
    const report = inspectBookData({ questions: rows }, ['images/synthetic-1.jpg']);
    expect(report).toMatchObject({ total: 3, unknownYears: 3, blankChoices: 1, formula: 1, referenceErrors: 3 });
    expect(report.missingImages).toHaveLength(0); // Each synthetic row intentionally references the same existing image.
    const duplicate = inspectBookData({ questions: [row(), row()] }, []);
    expect(duplicate.duplicateIds).toEqual(['synthetic-1']);
    expect(duplicate.fatalErrors).not.toEqual([]);
    expect(duplicate.missingImages).toHaveLength(2);
    const question = convertBookData({ questions: rows })[0];
    expect(question.choices[0]).toBe('');
    expect(question.book!.explanationRef).toBe('missing');
  });

  it('blocks inferred automatic approval and full images, requiring a separate safe exam crop for drawings and formulas', () => {
    const pending = convertBookData({ questions: [row({ choicesAreImages: true, textVerified: true })] })[0];
    expect(isBookQuestionEligible(pending, [pending])).toBe(false);
    const question = reviewed({ questionHasImage: true, reviewFlags: ['formula_check_image'] });
    expect(bookApprovalIssues(question, [question]).join(' ')).toContain('크롭');
    question.book!.examImageId = question.book!.reviewImageId;
    question.book!.review.examImageSafe = true;
    expect(isBookQuestionEligible(question, [question])).toBe(false);
    question.book!.examImageId = 'exam-crop-new-id';
    expect(isBookQuestionEligible(question, [question])).toBe(true);
    question.book!.review.flagsChecked = false;
    expect(isBookQuestionEligible(question, [question])).toBe(false);
  });

  it('keeps broken reference chains blocked after a checkbox until the actual reference is repaired', () => {
    const source = reviewed({ explanationRef: 'synthetic-target' });
    const target = reviewed({ id: 'synthetic-target', explanation: '' });
    expect(bookApprovalIssues(source, [source, target]).join(' ')).toContain('참조 대상 내용 누락');
    target.explanation = '확인한 대상 해설';
    expect(bookApprovalIssues(source, [source, target])).toEqual([]);
    target.book!.explanationRef = source.book!.originalId;
    expect(bookApprovalIssues(source, [source, target]).join(' ')).toContain('참조 순환');
  });

  it('requires an explanation check and substantive own explanation or a complete reference', () => {
    const unchecked = reviewed();
    unchecked.book!.review.explanationChecked = false;
    expect(isBookQuestionEligible(unchecked, [unchecked])).toBe(false);
    const empty = reviewed({ explanation: '', explanationRef: null });
    expect(bookApprovalIssues(empty, [empty])).toContain('해설 내용 또는 완전한 해설 참조 필요');
    const placeholder = reviewed({ explanation: '이전 해설 참조' });
    expect(isBookQuestionEligible(placeholder, [placeholder])).toBe(false);
    const reference = reviewed({ id: 'reference-source', explanation: '', explanationRef: 'reference-target' });
    const target = reviewed({ id: 'reference-target' });
    expect(isBookQuestionEligible(reference, [reference, target])).toBe(true);
    target.explanation = '';
    expect(isBookQuestionEligible(reference, [reference, target])).toBe(false);
  });

  it('does not crash or admit malformed book metadata from an older backup', () => {
    const question = reviewed();
    question.book = { originalId: 'synthetic-1' } as typeof question.book;
    expect(() => isBookQuestionEligible(question, [question])).not.toThrow();
    expect(isBookQuestionEligible(question, [question])).toBe(false);
    question.book = { ...reviewed().book!, issues: [1] } as unknown as typeof question.book;
    expect(() => isBookQuestionEligible(question, [question])).not.toThrow();
    expect(isBookQuestionEligible(question, [question])).toBe(false);
  });

  it('does not clear uncertain source metadata with review acknowledgements', () => {
    const uncertain = reviewed({ subject: '불확실한 원본 분류' });
    expect(bookApprovalIssues(uncertain, [uncertain])).toContain('원본 과목명과 과목 번호 불일치');
    const invalidCoordinates = reviewed();
    invalidCoordinates.book!.source.spans = [{ page: 2, column: 'L', y0: 0.8, y1: 0.1 }];
    expect(bookApprovalIssues(invalidCoordinates, [invalidCoordinates])).toContain('원본 페이지 위치 확인 필요');
  });
  it('permits a manually compared safe exam crop while acknowledging the originally absent explanation', () => {
    const exam = reviewed({ section: 'exam', examRound: { round: 1, year: 2025 }, frequency: null, explanation: '', explanationRef: null, questionHasImage: true });
    exam.book!.examImageId = 'manually-checked-exam-crop';
    exam.book!.review.examImageSafe = true;
    expect(isBookQuestionEligible(exam, [exam])).toBe(true);
    expect(exam.explanation).toBe('');
    expect(exam.book!.review.automatic).toBeUndefined();
    exam.book!.review.explanationChecked = false;
    expect(isBookQuestionEligible(exam, [exam])).toBe(false);
    exam.book!.review.explanationChecked = true;
    exam.book!.review.examImageSafe = false;
    expect(isBookQuestionEligible(exam, [exam])).toBe(false);
    const chapter = reviewed({ explanation: '', explanationRef: null });
    expect(isBookQuestionEligible(chapter, [chapter])).toBe(false);
  });
  it('never admits ordinary restored questions with a missing answer or choices', () => {
    const ordinary = { ...reviewed(), book: undefined, status: 'verified' as const };
    expect(isBookQuestionEligible(ordinary)).toBe(true);
    expect(isBookQuestionEligible({ ...ordinary, answer: null })).toBe(false);
    expect(isBookQuestionEligible({ ...ordinary, answer: 5 })).toBe(false);
    expect(isBookQuestionEligible({ ...ordinary, choices: ['', '나', '다', '라'] })).toBe(false);
    expect(isBookQuestionEligible({ ...ordinary, prompt: '  ' })).toBe(false);
  });

});

describe('authorized automatic structural approval', () => {
  const archiveHash = 'a'.repeat(64);
  it('approves safe text records without falsely recording human source comparison', () => {
    const questions = convertBookData({ questions: [row({ reviewFlags: ['choices_markers_inferred'], answerSource: 'ocr' }), row({ id: 'synthetic-2', answerSource: 'ocr_digit_crop' })] });
    const before = structuredClone(questions);
    const result = autoApproveBookQuestions(questions, archiveHash);
    expect(result.approved).toHaveLength(2);
    expect(result.pending).toEqual([]);
    expect(result.approved.every((question) => isBookQuestionEligible(question, result.questions))).toBe(true);
    expect(questions).toEqual(before);
    expect(result.approved[0].book!.review).toMatchObject({ sourceCompared: false, flagsChecked: false, explanationChecked: false, examImageSafe: false, automatic: { method: 'structure-v1', archiveHash } });
    expect(result.approved[0].book!.textVerified).toBe(false);
  });

  it('keeps images, formulas, empty choices, uncertain metadata, invalid answer sources and flags pending', () => {
    const records = [
      row({ id: 'graphic', choicesAreImages: true }), row({ id: 'question-image', questionHasImage: true }),
      row({ id: 'formula', reviewFlags: ['formula_check_image'] }), row({ id: 'empty-choice', choices: ['가', '', '다', '라'] }),
      row({ id: 'uncertain-source', source: { page: 0, spans: [] } }), row({ id: 'uncertain-answer', answerSource: 'unknown' }),
      row({ id: 'other-flag', reviewFlags: ['first_choice_recovered'] }), row({ id: 'empty-explanation', explanation: '' }),
    ];
    const questions = convertBookData({ questions: records });
    const result = autoApproveBookQuestions(questions, archiveHash);
    expect(result.approved).toEqual([]);
    expect(result.pending).toHaveLength(records.length);
    expect(Object.keys(result.pendingReasons)).toHaveLength(records.length);
    expect(result.pending.every((question) => question.status === 'pending' && !question.book!.review.automatic)).toBe(true);
  });

  it('rechecks machine markers and original content every time, blocking forged or stale approval', () => {
    const question = autoApproveBookQuestions(convertBookData({ questions: [row()] }), archiveHash).approved[0];
    expect(isBookQuestionEligible(question, [question])).toBe(true);
    question.answer = 4;
    expect(automaticBookApprovalIssues(question, [question]).join(' ')).toContain('수정된 문항');
    expect(isBookQuestionEligible(question, [question])).toBe(false);
    question.answer = 2;
    question.book!.review.automatic!.archiveHash = 'forged';
    expect(isBookQuestionEligible(question, [question])).toBe(false);
    const graphic = convertBookData({ questions: [row({ choicesAreImages: true })] })[0];
    graphic.status = 'verified';
    graphic.book!.review.automatic = { checkedAt: new Date().toISOString(), method: 'structure-v1', archiveHash };
    expect(isBookQuestionEligible(graphic, [graphic])).toBe(false);
    expect(() => autoApproveBookQuestions([graphic], 'missing-archive-hash')).toThrow('SHA-256');
  });

  it('accepts complete explanation references and blocks missing, empty, or cyclic targets', () => {
    const valid = convertBookData({ questions: [row({ id: 'source', explanation: '', explanationRef: 'target' }), row({ id: 'target' })] });
    const result = autoApproveBookQuestions(valid, archiveHash);
    expect(result.approved).toHaveLength(2);
    result.questions[1].explanation = '';
    expect(isBookQuestionEligible(result.questions[0], result.questions)).toBe(false);
    const invalid = convertBookData({ questions: [row({ id: 'missing', explanationRef: 'absent' }), row({ id: 'cycle-a', explanationRef: 'cycle-b' }), row({ id: 'cycle-b', explanationRef: 'cycle-a' })] });
    expect(autoApproveBookQuestions(invalid, archiveHash).pending).toHaveLength(3);
  });

  it('allows explicit absent explanations only in otherwise safe original exam records and records the absence', () => {
    const questions = convertBookData({ questions: [
      row({ id: 'exam-empty', section: 'exam', examRound: { round: 1, year: 2025 }, frequency: null, explanation: '', explanationRef: null }),
      row({ id: 'chapter-empty', explanation: '', explanationRef: null }),
      row({ id: 'exam-ref-broken', section: 'exam', examRound: { round: 1, year: 2025 }, frequency: null, explanation: '', explanationRef: 'absent' }),
    ] });
    const result = autoApproveBookQuestions(questions, archiveHash);
    expect(result.approved.map((question) => question.book!.originalId)).toEqual(['exam-empty']);
    expect(result.pending.map((question) => question.book!.originalId)).toEqual(['chapter-empty', 'exam-ref-broken']);
    const exam = result.approved[0];
    expect(exam.explanation).toBe('');
    expect(exam.book!.review.automatic?.explanationUnavailable).toBe(true);
    expect(exam.book!.review.sourceCompared).toBe(false);
    expect(isBookQuestionEligible(exam, result.questions)).toBe(true);
    delete exam.book!.review.automatic!.explanationUnavailable;
    expect(isBookQuestionEligible(exam, result.questions)).toBe(false);
  });
});
