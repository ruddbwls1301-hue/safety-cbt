import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BookImportManifest, PdfDraft, PdfPageText, PdfSource, Question, UserData } from '../types';
import { convertBookData } from './bookData';

const DB_NAME = 'industrial-safety-cbt';
function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); }); }
function done(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onabort = transaction.onerror = () => reject(transaction.error); }); }
function syntheticQuestion(id: string, separateImages = false): Question {
  return convertBookData({ questions: [{ id, section: 1, subjectNo: 1, subject: '산업재해 예방 및 안전보건교육', examRound: null, no: 1, frequency: 1, question: '검증용 지문', choices: ['가', '나', '다', '라'], answer: 1, answerSource: 'manual_visual_check', explanation: '검증용 해설', explanationRef: null, reviewFlags: [], ...(separateImages ? { explanationImage: `images/${id}.jpg`, questionImage: `images_question/${id}.jpg` } : { image: `images/${id}.jpg` }), source: { page: 1, spans: [{ page: 1, column: 'L', y0: 0.1, y1: 0.2 }] } }] })[0];
}
const manifest: BookImportManifest = { importId: 'synthetic-import', archiveName: 'synthetic.zip', archiveHash: 'synthetic-hash', sourceMeta: { title: '검증 자료' }, counts: { total: 2, added: 0, skipped: 0, images: 2 }, status: 'staging', createdAt: '2026-01-01T00:00:00.000Z' };
const preservedQuestion: Question = {
  id: 'existing', year: 2024, round: '1회', originalSubject: '산업재해 예방 및 안전보건교육',
  prompt: '기존 검수 지문', choices: ['기존 가', '기존 나', '기존 다', '기존 라'], answer: 2,
  explanation: '기존 검수 해설', status: 'verified', source: '기존 PDF', sourceDocumentId: 'existing-pdf', sourcePage: 2,
  createdAt: '2025-12-01T00:00:00.000Z',
};
const preservedUser: UserData = {
  key: 'state',
  attempts: [{
    id: 'preserved-attempt', title: '기존 완료 시험', scheme: 'legacy', mode: 'subject',
    questionIds: ['existing'], answers: { existing: 2 }, startedAt: '2025-12-02T00:00:00.000Z',
    submittedAt: '2025-12-02T00:03:00.000Z', remainingSeconds: 120,
  }],
  bookmarks: ['existing', 'kept-other-bookmark'], theme: 'dark',
  activeSession: {
    id: 'preserved-active', title: '기존 이어풀기', scheme: 'legacy', mode: 'random', questionIds: ['existing'],
    answers: { existing: 4 }, markedIds: ['existing'], index: 0, startedAt: '2025-12-03T00:00:00.000Z', deadlineAt: 1791468000000,
  },
};
const preservedSource: PdfSource = {
  id: 'existing-pdf', name: 'kept.pdf', size: 12, pageCount: 3, pageStart: 1, pageEnd: 3,
  lastProcessedPage: 2, importedAt: '2025-12-01T00:00:00.000Z', status: 'failed',
  defaultYear: null, defaultRound: '', defaultOriginalSubject: '산업재해 예방 및 안전보건교육', error: '기존 중단 정보',
};
const preservedDraft: PdfDraft = {
  id: 'existing-pdf:2:1', sourceId: preservedSource.id, sourcePage: 2, sequence: 1, questionNumber: 12,
  year: null, round: '', originalSubject: preservedSource.defaultOriginalSubject,
  prompt: '기존 PDF 검수 대기 지문', choices: ['가', '나', '', '라'], answer: null, explanation: '',
  rawText: '기존 OCR 원문', confidence: 76, extractionMethod: 'ocr', status: 'pending',
  issues: ['3번 보기 누락', '정답 누락'], createdAt: '2025-12-01T00:00:00.000Z',
};
const preservedPage: PdfPageText = {
  id: 'existing-pdf:2', sourceId: preservedSource.id, sourcePage: 2, text: '기존 페이지 OCR 원문',
  confidence: 76, extractionMethod: 'ocr', questionCount: 1,
};
async function expectPriorDataUnchanged(db: typeof import('./db')) {
  expect(await db.getUserData()).toEqual(preservedUser);
  expect((await db.getQuestions()).find((question) => question.id === preservedQuestion.id)).toEqual(preservedQuestion);
  expect(await db.getPdfSources()).toEqual([preservedSource]);
  expect(await db.getPdfDrafts()).toEqual([preservedDraft]);
  expect(await db.getPdfPageTexts(preservedSource.id)).toEqual([preservedPage]);
  const pdf = await db.getPdfFile(preservedSource.id);
  expect(pdf?.type).toBe('application/pdf');
  expect(await pdf?.text()).toBe('pdf-original');
}

describe('explicit book import storage', () => {
  beforeAll(async () => {
    await request(indexedDB.deleteDatabase(DB_NAME));
    const opening = indexedDB.open(DB_NAME, 3);
    opening.onupgradeneeded = () => {
      for (const [name, keyPath] of [['questionBank', 'id'], ['userData', 'key'], ['pdfSources', 'id'], ['pdfFiles', 'id'], ['pdfDrafts', 'id'], ['pdfPageTexts', 'id']]) opening.result.createObjectStore(name, { keyPath });
    };
    const database = await request(opening);
    const transaction = database.transaction(['questionBank', 'userData', 'pdfFiles', 'pdfSources', 'pdfDrafts', 'pdfPageTexts'], 'readwrite');
    transaction.objectStore('questionBank').put(preservedQuestion);
    transaction.objectStore('userData').put(preservedUser);
    transaction.objectStore('pdfFiles').put({ id: preservedSource.id, blob: new Blob(['pdf-original'], { type: 'application/pdf' }) });
    transaction.objectStore('pdfSources').put(preservedSource);
    transaction.objectStore('pdfDrafts').put(preservedDraft);
    transaction.objectStore('pdfPageTexts').put(preservedPage);
    await done(transaction);
    database.close();
  });

  it('does not upgrade or create book stores during ordinary reading', async () => {
    const db = await import('./db');
    await db.getQuestions();
    expect(await db.getBookImage('missing')).toBeUndefined();
    const database = await request(indexedDB.open(DB_NAME));
    expect(database.version).toBe(3);
    expect(database.objectStoreNames.contains('bookImages')).toBe(false);
    database.close();
    await expectPriorDataUnchanged(db);
  });

  it('adds images explicitly and commits pending questions while preserving study and PDF records', async () => {
    const db = await import('./db');
    const first = syntheticQuestion('synthetic-first');
    const second = syntheticQuestion('synthetic-second');
    const progress: number[] = [];
    await db.saveBookImages([first, second].map((question) => ({ id: question.book!.reviewImageId, kind: 'review', blob: new Blob(['image']), createdAt: manifest.createdAt })), (completed) => progress.push(completed));
    expect(progress).toEqual([2]);
    first.status = 'verified'; // Import cannot carry approval into the bank.
    expect(await db.commitBookImport([first, second], manifest)).toEqual({ added: 2, skipped: 0 });
    const saved = await db.getQuestions();
    expect(saved.find((question) => question.id === first.id)?.status).toBe('pending');
    await expectPriorDataUnchanged(db);
    expect((await db.getBookImportManifests())[0]).toMatchObject({ status: 'complete', counts: { added: 2, skipped: 0 } });
  });

  it('skips stable IDs on reimport and preserves edits, approval, and immutable image bytes', async () => {
    const db = await import('./db');
    const question = syntheticQuestion('synthetic-first');
    await db.saveQuestion({ ...question, prompt: '사용자 검수 수정', status: 'verified' });
    const bankBefore = await db.getQuestions();
    await db.saveBookImages([{ id: question.book!.reviewImageId, kind: 'review', blob: new Blob(['replaced-image']), createdAt: manifest.createdAt }]);
    expect(await db.commitBookImport([question], { ...manifest, importId: 'repeat' })).toEqual({ added: 0, skipped: 1 });
    expect((await db.getQuestions()).find((item) => item.id === question.id)).toMatchObject({ prompt: '사용자 검수 수정', status: 'verified' });
    expect(await (await db.getBookImage(question.book!.reviewImageId))!.blob.text()).toBe('image');
    expect(await db.getQuestions()).toEqual(bankBefore);
    await expectPriorDataUnchanged(db);
  });

  it('rolls back every new question and the completion manifest when any review image is absent', async () => {
    const db = await import('./db');
    const available = syntheticQuestion('synthetic-available');
    const absent = syntheticQuestion('synthetic-absent');
    const bankBefore = await db.getQuestions();
    await db.saveBookImages([{ id: available.book!.reviewImageId, kind: 'review', blob: new Blob(['staged-image']), createdAt: manifest.createdAt }]);
    await expect(db.commitBookImport([available, absent], { ...manifest, importId: 'fail' })).rejects.toThrow('검수 원본 이미지');
    const saved = await db.getQuestions();
    expect(saved.some((question) => question.id === available.id || question.id === absent.id)).toBe(false);
    expect(saved).toEqual(bankBefore);
    expect((await db.getBookImportManifests()).some((item) => item.importId === 'fail')).toBe(false);
    await expectPriorDataUnchanged(db);
  });

  it('stores question-only candidates separately and immutably without granting exam-image approval', async () => {
    const db = await import('./db');
    const question = syntheticQuestion('synthetic-candidate', true);
    await db.saveBookImages([
      { id: question.book!.reviewImageId, kind: 'review', blob: new Blob(['full-review-image']), createdAt: manifest.createdAt },
      { id: question.book!.sourceQuestionImageId!, kind: 'candidate-exam', blob: new Blob(['candidate-question-image']), createdAt: manifest.createdAt },
    ]);
    expect(await db.commitBookImport([question], { ...manifest, importId: 'candidate-success' })).toEqual({ added: 1, skipped: 0 });
    const candidate = await db.getBookImage(question.book!.sourceQuestionImageId!);
    expect(candidate?.kind).toBe('candidate-exam');
    expect(await candidate?.blob.text()).toBe('candidate-question-image');
    const savedQuestion = (await db.getQuestions()).find((row) => row.id === question.id)!;
    expect(savedQuestion.book!.examImageId).toBeUndefined();
    expect(savedQuestion.book!.review.examImageSafe).toBe(false);
    expect(savedQuestion.status).toBe('pending');
    await db.saveBookImages([{ id: question.book!.sourceQuestionImageId!, kind: 'exam', blob: new Blob(['attempted-replacement']), createdAt: manifest.createdAt }]);
    const unchanged = await db.getBookImage(question.book!.sourceQuestionImageId!);
    expect(unchanged?.kind).toBe('candidate-exam');
    expect(await unchanged?.blob.text()).toBe('candidate-question-image');
    await expectPriorDataUnchanged(db);
  });

  it('atomically rejects missing or incorrectly classified question candidates and preserves all existing data', async () => {
    const db = await import('./db');
    const available = syntheticQuestion('synthetic-candidate-available', true);
    const absent = syntheticQuestion('synthetic-candidate-absent', true);
    const bankBefore = await db.getQuestions();
    await db.saveBookImages([
      { id: available.book!.reviewImageId, kind: 'review', blob: new Blob(['available-review']), createdAt: manifest.createdAt },
      { id: available.book!.sourceQuestionImageId!, kind: 'candidate-exam', blob: new Blob(['available-candidate']), createdAt: manifest.createdAt },
      { id: absent.book!.reviewImageId, kind: 'review', blob: new Blob(['absent-candidate-review']), createdAt: manifest.createdAt },
    ]);
    await expect(db.commitBookImport([available, absent], { ...manifest, importId: 'candidate-missing' })).rejects.toThrow('문제용 원본 이미지');
    expect(await db.getQuestions()).toEqual(bankBefore);
    expect((await db.getBookImportManifests()).some((row) => row.importId === 'candidate-missing')).toBe(false);
    await db.saveBookImages([{ id: absent.book!.sourceQuestionImageId!, kind: 'review', blob: new Blob(['incorrect-kind']), createdAt: manifest.createdAt }]);
    await expect(db.commitBookImport([available, absent], { ...manifest, importId: 'candidate-wrong-kind' })).rejects.toThrow('문제용 원본 이미지');
    expect(await db.getQuestions()).toEqual(bankBefore);
    expect((await db.getBookImportManifests()).some((row) => row.importId === 'candidate-wrong-kind')).toBe(false);
    await expectPriorDataUnchanged(db);
  });
});
