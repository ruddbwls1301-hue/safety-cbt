import { describe, expect, it } from 'vitest';
import { correctionLabel, groupCorrections, parseCorrectionFile, proposeCorrection, wantsCandidateExamImage, type CorrectionFile } from './corrections';
import { autoApproveBookQuestions, convertBookData, isBookQuestionEligible } from './bookData';
import type { Question } from '../types';

// Synthetic fixtures only.
function autoApproved(): Question {
  const [converted] = convertBookData({ questions: [{
    id: 'unit-fix', section: 2, subjectNo: 2, subject: '인간공학 및 위험성 평가·관리', no: 9, frequency: 1, examRound: null,
    question: '합성 지문: 기호와 의미가 잘못 연결된 것은?', choices: ['0 : 지체', 'V : 저장', '5: 운반', '0: 가공'], answer: 2, answerSource: 'ocr',
    explanation: '합성 해설 0', explanationRef: null, image: 'images/unit-fix.jpg', source: { page: 2, spans: [{ page: 2, column: 'L', y0: 0.1, y1: 0.5 }] },
    questionHasImage: false, choicesAreImages: false, textVerified: false, reviewFlags: [],
  }] });
  return autoApproveBookQuestions([converted], 'a'.repeat(64)).questions[0];
}
const file = (question: Question, extra: unknown[] = []): CorrectionFile => parseCorrectionFile({ kind: 'cbt-corrections', version: 1, items: [
  { questionId: question.id, field: 'choice', index: 0, before: '0 : 지체', after: '□ : 지체', note: '원본 ①' },
  { questionId: question.id, field: 'choice', index: 2, before: '5: 운반', after: '⇒: 운반' },
  { questionId: question.id, field: 'answer', before: 2, after: 1 },
  ...extra,
] });

describe('correction file parsing', () => {
  it('rejects other files, bad targets, no-op and duplicate proposals', () => {
    const base = { kind: 'cbt-corrections', version: 1 };
    expect(() => parseCorrectionFile({ version: 1, questions: [] })).toThrow('교정안 파일 형식');
    expect(() => parseCorrectionFile({ ...base, items: [{ questionId: 'a', field: 'choice', index: 4, before: 'x', after: 'y' }] })).toThrow('보기 위치');
    expect(() => parseCorrectionFile({ ...base, items: [{ questionId: 'a', field: 'answer', before: 1, after: 5 }] })).toThrow('정답 번호');
    expect(() => parseCorrectionFile({ ...base, items: [{ questionId: 'a', field: 'prompt', before: 'x', after: 'x' }] })).toThrow('같습니다');
    expect(() => parseCorrectionFile({ ...base, items: [{ questionId: 'a', field: 'prompt', before: 'x', after: 'y' }, { questionId: 'a', field: 'prompt', before: 'x', after: 'z' }] })).toThrow('중복');
    expect(() => parseCorrectionFile({ ...base, items: [{ questionId: 'a', field: 'prompt', before: 'x', after: 3 }] })).toThrow('문자열');
  });
  it('labels fields for people', () => {
    expect(correctionLabel({ questionId: 'a', field: 'choice', index: 2, before: 'x', after: 'y' })).toBe('보기 3');
    expect(correctionLabel({ questionId: 'a', field: 'explanation', before: 'x', after: 'y' })).toBe('해설');
  });
});

describe('correction proposals', () => {
  it('proposes under the same ID, returns to pending and clears source-comparison marks without touching the source record', () => {
    const question = autoApproved();
    const before = structuredClone(question);
    const [group] = groupCorrections(file(question), [question]);
    expect(group.state).toBe('ready');
    const proposed = proposeCorrection(group);
    expect(question).toEqual(before);
    expect(proposed.id).toBe(question.id);
    expect(proposed.choices).toEqual(['□ : 지체', 'V : 저장', '⇒: 운반', '0: 가공']);
    expect(proposed.answer).toBe(1);
    expect(proposed.status).toBe('pending');
    expect(proposed.book!.review).toEqual({ sourceCompared: false, flagsChecked: false, explanationChecked: false, examImageSafe: false });
    expect(proposed.book!.rawRecord).toEqual(question.book!.rawRecord);
    expect(isBookQuestionEligible(proposed, [proposed])).toBe(false);
    expect(isBookQuestionEligible({ ...proposed, status: 'verified' }, [proposed])).toBe(false);
  });
  it('keeps explanation-only changes from clearing the question comparison mark', () => {
    const question = autoApproved();
    question.book!.review = { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: false };
    const only = parseCorrectionFile({ kind: 'cbt-corrections', version: 1, items: [{ questionId: question.id, field: 'explanation', before: '합성 해설 0', after: '합성 해설 ○' }] });
    const proposed = proposeCorrection(groupCorrections(only, [question])[0]);
    expect(proposed.book!.review).toEqual({ sourceCompared: true, flagsChecked: true, explanationChecked: false, examImageSafe: false });
    expect(proposed.status).toBe('pending');
  });
  it('reports already-applied, conflicting and missing questions instead of overwriting', () => {
    const question = autoApproved();
    const applied: Question = { ...question, choices: ['□ : 지체', 'V : 저장', '⇒: 운반', '0: 가공'], answer: 1 };
    expect(groupCorrections(file(question), [applied])[0].state).toBe('applied');
    const edited: Question = { ...question, choices: ['ㅁ : 지체', 'V : 저장', '5: 운반', '0: 가공'] };
    const [conflict] = groupCorrections(file(question), [edited]);
    expect(conflict.state).toBe('conflict');
    expect(conflict.items[0]).toMatchObject({ state: 'conflict', current: 'ㅁ : 지체' });
    expect(() => proposeCorrection(conflict)).toThrow();
    const groups = groupCorrections(file(question, [{ questionId: 'unit-absent', field: 'prompt', before: 'x', after: 'y' }]), [question]);
    expect(groups.map((group) => group.state)).toEqual(['ready', 'missing']);
  });
  it('applies only what is still pending when part of a question was already corrected', () => {
    const question = autoApproved();
    const partly: Question = { ...question, choices: ['□ : 지체', 'V : 저장', '5: 운반', '0: 가공'] };
    const [group] = groupCorrections(file(question), [partly]);
    expect(group.items.map((entry) => entry.state)).toEqual(['applied', 'ready', 'ready']);
    expect(proposeCorrection(group).choices).toEqual(['□ : 지체', 'V : 저장', '⇒: 운반', '0: 가공']);
  });
  it('proposes the archive question image without touching text, review marks or the stored link', () => {
    const question = autoApproved();
    question.book!.sourceQuestionImageId = 'unit-candidate-image';
    question.book!.review = { ...question.book!.review, sourceCompared: true };
    const file = parseCorrectionFile({ kind: 'cbt-corrections', version: 1, items: [{ questionId: question.id, field: 'examImage', before: null, after: 'candidate', note: '그림 누락' }] });
    const [group] = groupCorrections(file, [question]);
    expect(group.state).toBe('ready');
    expect(wantsCandidateExamImage(group)).toBe(true);
    expect(correctionLabel(file.items[0])).toBe('시험용 이미지(그림 포함)');
    const proposed = proposeCorrection(group);
    expect(proposed.prompt).toBe(question.prompt);
    expect(proposed.choices).toEqual(question.choices);
    expect(proposed.book!.examImageId).toBeUndefined();
    expect(proposed.book!.review.sourceCompared).toBe(true);
    expect(proposed.book!.review.automatic).toBeUndefined();
    expect(proposed.status).toBe('pending');
  });
  it('treats a linked exam image as handled and refuses questions without an archive image', () => {
    const question = autoApproved();
    const file = parseCorrectionFile({ kind: 'cbt-corrections', version: 1, items: [{ questionId: question.id, field: 'examImage', before: null, after: 'candidate' }] });
    expect(groupCorrections(file, [question])[0].state).toBe('conflict');
    question.book!.sourceQuestionImageId = 'unit-candidate-image';
    question.book!.examImageId = 'unit-candidate-image:exam:1';
    const [group] = groupCorrections(file, [question]);
    expect(group.state).toBe('applied');
    expect(wantsCandidateExamImage(group)).toBe(false);
  });
  it('rejects malformed exam image proposals', () => {
    expect(() => parseCorrectionFile({ kind: 'cbt-corrections', version: 1, items: [{ questionId: 'a', field: 'examImage', before: null, after: 'images/x.jpg' }] })).toThrow('시험용 이미지');
  });
});
