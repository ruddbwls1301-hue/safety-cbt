import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PdfDraft, PdfPageText, PdfSource, Question, UserData } from '../types';

const DB_NAME = 'industrial-safety-cbt';

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function openVersionOne(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('questionBank', { keyPath: 'id' });
      request.result.createObjectStore('userData', { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

describe('IndexedDB v1 to v2 upgrade', () => {
  beforeAll(async () => {
    await deleteDatabase();
    const database = await openVersionOne();
    const question: Question = {
      id: 'kept-question', year: 2024, round: '1회', originalSubject: '산업재해 예방 및 안전보건교육',
      prompt: '기존 문제', choices: ['가', '나', '다', '라'], answer: 2, explanation: '기존 해설',
      status: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
    };
    const userData: UserData = {
      key: 'state', attempts: [{ id: 'kept-attempt', title: '기록', scheme: 'legacy', mode: 'random', questionIds: ['kept-question'], answers: { 'kept-question': 2 }, startedAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-01T00:10:00.000Z', remainingSeconds: 0 }],
      bookmarks: ['kept-question'], theme: 'dark',
    };
    const transaction = database.transaction(['questionBank', 'userData'], 'readwrite');
    transaction.objectStore('questionBank').put(question);
    transaction.objectStore('userData').put(userData);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    database.close();
  });

  it('preserves questions and study history while adding PDF stores', async () => {
    const db = await import('./db');
    const [questions, userData, sources, drafts] = await Promise.all([
      db.getQuestions(), db.getUserData(), db.getPdfSources(), db.getPdfDrafts(),
    ]);
    expect(questions).toHaveLength(1);
    expect(questions[0].id).toBe('kept-question');
    expect(userData.attempts[0].id).toBe('kept-attempt');
    expect(userData.bookmarks).toEqual(['kept-question']);
    expect(userData.theme).toBe('dark');
    expect(sources).toEqual([]);
    expect(drafts).toEqual([]);
  });

  it('stores the source once and atomically approves only a reviewed draft', async () => {
    const db = await import('./db');
    const source: PdfSource = {
      id: 'local-pdf', name: 'practice.pdf', size: 3, pageCount: 1, pageStart: 1, pageEnd: 1,
      lastProcessedPage: 0, importedAt: '2026-01-01T00:00:00.000Z', status: 'processing',
      defaultYear: 2024, defaultRound: '1회', defaultOriginalSubject: '산업재해 예방 및 안전보건교육',
    };
    await db.createPdfImport(source, new Blob(['pdf bytes'], { type: 'application/pdf' }));
    const draft: PdfDraft = {
      id: 'local-pdf:1:1', sourceId: source.id, sourcePage: 1, sequence: 1, questionNumber: 1,
      year: 2024, round: '1회', originalSubject: source.defaultOriginalSubject, prompt: '검수 문항',
      choices: ['가', '나', '다', '라'], answer: 2, explanation: '원문 해설', rawText: 'OCR 원문', confidence: 98,
      extractionMethod: 'ocr', status: 'pending', issues: [], createdAt: '2026-01-01T00:00:00.000Z',
    };
    const pageText: PdfPageText = { id: 'local-pdf:1', sourceId: source.id, sourcePage: 1, text: 'OCR 원문', confidence: 98, extractionMethod: 'ocr', questionCount: 1 };
    await db.savePdfPage({ ...source, lastProcessedPage: 1 }, [draft], pageText);
    const approved: Question = {
      id: 'approved-question', year: 2024, round: '1회', originalSubject: source.defaultOriginalSubject,
      prompt: draft.prompt, choices: draft.choices, answer: 2, explanation: draft.explanation, status: 'verified',
      source: source.name, sourcePage: 1, sourceDocumentId: source.id, createdAt: '2026-01-01T00:01:00.000Z',
    };
    await db.approvePdfDraft(approved, draft.id);

    expect(await (await db.getPdfFile(source.id))?.text()).toBe('pdf bytes');
    expect((await db.getPdfDrafts(source.id))[0].status).toBe('verified');
    expect((await db.getPdfPageTexts(source.id))[0].text).toBe('OCR 원문');
    expect((await db.getQuestions()).map((question) => question.id)).toContain('approved-question');
    expect((await db.getUserData()).attempts[0].id).toBe('kept-attempt');
    await expect(db.deletePdfImport(source.id)).rejects.toThrow('승인된 문항');
    expect(await db.getPdfFile(source.id)).toBeDefined();

    const temporarySource: PdfSource = { ...source, id: 'temporary-pdf', name: 'temporary.pdf' };
    await db.createPdfImport(temporarySource, new Blob(['temp']));
    await db.savePdfPage({ ...temporarySource, lastProcessedPage: 1 }, [], { ...pageText, id: 'temporary-pdf:1', sourceId: 'temporary-pdf' });
    await db.deletePdfImport(temporarySource.id);
    expect(await db.getPdfFile(temporarySource.id)).toBeUndefined();
    expect(await db.getPdfSources()).toHaveLength(1);
    expect(await db.getPdfPageTexts(temporarySource.id)).toEqual([]);
  });

  it('restarts pending OCR while preserving the PDF file and study data', async () => {
    const db = await import('./db');
    const source: PdfSource = {
      id: 'restart-pdf', name: 'book.pdf', size: 3, pageCount: 4, pageStart: 1, pageEnd: 4,
      lastProcessedPage: 0, importedAt: '2026-01-01T00:00:00.000Z', status: 'processing',
      defaultYear: null, defaultRound: '', defaultOriginalSubject: '',
    };
    const draft: PdfDraft = {
      id: 'restart-pdf:1:1', sourceId: source.id, sourcePage: 1, sequence: 1, questionNumber: 1,
      year: null, round: '', originalSubject: '', prompt: '검수 대기 문항', choices: ['', '', '', ''],
      answer: null, explanation: '', rawText: 'OCR 원문', confidence: 85, extractionMethod: 'ocr',
      status: 'pending', issues: ['원본 과목 미확인'], createdAt: '2026-01-01T00:00:00.000Z',
    };
    const pageText: PdfPageText = { id: 'restart-pdf:1', sourceId: source.id, sourcePage: 1, text: 'OCR 원문', confidence: 85, extractionMethod: 'ocr', questionCount: 1 };
    await db.createPdfImport(source, new Blob(['pdf bytes'], { type: 'application/pdf' }));
    await db.savePdfPage({ ...source, lastProcessedPage: 1 }, [draft], pageText);

    const restarted = await db.restartPdfImport(source.id);
    expect(restarted).toMatchObject({ lastProcessedPage: 0, status: 'processing' });
    expect(await (await db.getPdfFile(source.id))?.text()).toBe('pdf bytes');
    expect(await db.getPdfDrafts(source.id)).toEqual([]);
    expect(await db.getPdfPageTexts(source.id)).toEqual([]);
    expect((await db.getUserData()).attempts[0].id).toBe('kept-attempt');
    await db.deletePdfImport(source.id);
  });
});
