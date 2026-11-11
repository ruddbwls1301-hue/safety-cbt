import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { BookImage, Question, UserData } from '../types';

// Mirrors the verified Safari database: version 4 with all eight stores already present.
const DB_NAME = 'industrial-safety-cbt';
const STORES: [string, string][] = [['questionBank', 'id'], ['userData', 'key'], ['pdfSources', 'id'], ['pdfFiles', 'id'], ['pdfDrafts', 'id'], ['pdfPageTexts', 'id'], ['bookImages', 'id'], ['bookImports', 'importId']];
const question: Question = { id: 'industrial-safety-cbt-book:question:s1-001', year: null, round: '', originalSubject: '산업재해 예방 및 안전보건교육', prompt: '테스트 문항', choices: ['1', '2', '3', '4'], answer: 3, explanation: '해설', status: 'verified', createdAt: '2026-10-12T00:00:00.000Z' };
const user: UserData = { key: 'state', attempts: [{ id: 'a1', title: '연습', scheme: 'legacy', mode: 'subject', questionIds: [question.id], answers: { [question.id]: 3 }, startedAt: '2026-10-11T00:00:00.000Z', submittedAt: '2026-10-11T00:01:00.000Z', remainingSeconds: 10 }], bookmarks: [], theme: 'light' };
const image: BookImage = { id: 'industrial-safety-cbt-book:image:images%2Fs1-001.jpg', kind: 'review', blob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: 'image/jpeg' }), createdAt: '2026-10-12T00:00:00.000Z' };

function request<T>(value: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { value.onsuccess = () => resolve(value.result); value.onerror = () => reject(value.error); }); }
async function inspect(): Promise<{ version: number; stores: string[] }> {
  const databases = await indexedDB.databases();
  const version = databases.find((item) => item.name === DB_NAME)?.version ?? -1;
  const database = await request(indexedDB.open(DB_NAME));
  const stores = Array.from(database.objectStoreNames).sort();
  database.close();
  return { version, stores };
}

describe('existing version 4 database (Safari layout)', () => {
  beforeAll(async () => {
    const open = indexedDB.open(DB_NAME, 4);
    open.onupgradeneeded = () => { for (const [name, keyPath] of STORES) open.result.createObjectStore(name, { keyPath }); };
    const database = await request(open);
    const transaction = database.transaction(['questionBank', 'userData', 'bookImages'], 'readwrite');
    transaction.objectStore('questionBank').put(question);
    transaction.objectStore('userData').put(user);
    transaction.objectStore('bookImages').put(image);
    await new Promise((resolve) => { transaction.oncomplete = resolve; });
    database.close();
  });

  it('is read by the app without a version change, new stores, or rewritten ids', async () => {
    const before = await inspect();
    const db = await import('./db');
    const [questions, saved, stored] = await Promise.all([db.getQuestions(), db.getUserData(), db.getBookImage(image.id)]);
    expect(questions.map((item) => item.id)).toEqual([question.id]);
    expect(saved.attempts).toEqual(user.attempts);
    expect(saved.bookmarks).toEqual([]);
    expect(stored?.kind).toBe('review');
    expect(await db.getBookImportManifests()).toEqual([]);
    const after = await inspect();
    expect(before).toEqual({ version: 4, stores: STORES.map(([name]) => name).sort() });
    expect(after).toEqual(before);
  });
});
