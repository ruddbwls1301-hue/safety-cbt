import type { BookImage, BookImportManifest, PdfDraft, PdfPageText, PdfSource, Question, UserData } from '../types';
import { EMPTY_USER_DATA } from '../constants';
import { DEVICE_STORES, emptyDeviceSnapshot, type DeviceSnapshot } from './devicePackage';

const DB_NAME = 'industrial-safety-cbt';
const DB_VERSION = 3;

let connection: Promise<IDBDatabase> | undefined;
function openDatabase(): Promise<IDBDatabase> {
  if (!connection) {
    connection = new Promise((resolve, reject) => {
      // Opening without a version accepts a database upgraded by an explicit book import.
      // Merely viewing the app must not create the book stores.
      const request = indexedDB.open(DB_NAME);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains('questionBank')) database.createObjectStore('questionBank', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('userData')) database.createObjectStore('userData', { keyPath: 'key' });
        if (!database.objectStoreNames.contains('pdfSources')) database.createObjectStore('pdfSources', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('pdfFiles')) database.createObjectStore('pdfFiles', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('pdfDrafts')) database.createObjectStore('pdfDrafts', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('pdfPageTexts')) database.createObjectStore('pdfPageTexts', { keyPath: 'id' });
      };
      request.onsuccess = () => {
        if (request.result.version < DB_VERSION) {
          request.result.close();
          const upgrade = indexedDB.open(DB_NAME, DB_VERSION);
          upgrade.onupgradeneeded = () => {
            const database = upgrade.result;
            for (const [name, keyPath] of [['questionBank', 'id'], ['userData', 'key'], ['pdfSources', 'id'], ['pdfFiles', 'id'], ['pdfDrafts', 'id'], ['pdfPageTexts', 'id']]) {
              if (!database.objectStoreNames.contains(name)) database.createObjectStore(name, { keyPath });
            }
          };
          upgrade.onsuccess = () => {
            upgrade.result.onversionchange = () => { upgrade.result.close(); connection = undefined; };
            resolve(upgrade.result);
          };
          upgrade.onerror = () => { connection = undefined; reject(upgrade.error); };
          upgrade.onblocked = () => { connection = undefined; reject(new Error('다른 탭에서 데이터베이스를 사용 중입니다. 탭을 새로고침해 주세요.')); };
          return;
        }
        request.result.onversionchange = () => {
          request.result.close();
          connection = undefined;
        };
        resolve(request.result);
      };
      request.onerror = () => { connection = undefined; reject(request.error); };
      request.onblocked = () => { connection = undefined; reject(new Error('다른 탭에서 데이터베이스를 사용 중입니다. 탭을 새로고침해 주세요.')); };
    });
  }
  return connection;
}

let bookUpgrade: Promise<IDBDatabase> | undefined;
async function openBookDatabase(): Promise<IDBDatabase> {
  if (bookUpgrade) return bookUpgrade;
  const database = await openDatabase();
  if (bookUpgrade) return bookUpgrade;
  if (database.objectStoreNames.contains('bookImages') && database.objectStoreNames.contains('bookImports')) return database;
  database.close();
  connection = undefined;
  bookUpgrade = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, Math.max(4, database.version + 1));
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains('bookImages')) request.result.createObjectStore('bookImages', { keyPath: 'id' });
      if (!request.result.objectStoreNames.contains('bookImports')) request.result.createObjectStore('bookImports', { keyPath: 'importId' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('다른 탭에서 데이터베이스를 사용 중입니다. 탭을 새로고침한 후 가져오기를 다시 실행해 주세요.'));
  });
  connection = bookUpgrade;
  try { return await bookUpgrade; }
  catch (error) { connection = undefined; throw error; }
  finally { bookUpgrade = undefined; }
}

function transactionDone(transaction: IDBTransaction, failure?: () => Error | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(failure?.() ?? transaction.error ?? new Error('저장 실패'));
    transaction.onabort = () => reject(failure?.() ?? transaction.error ?? new Error('저장 취소'));
  });
}

/** Explicit import only. Existing image IDs are immutable and are skipped. */
export async function saveBookImages(records: BookImage[], onProgress?: (completed: number, total: number) => void): Promise<void> {
  const database = await openBookDatabase();
  const batchSize = 24;
  const seen = new Set<string>();
  for (let start = 0; start < records.length; start += batchSize) {
    const batch = records.slice(start, start + batchSize);
    const transaction = database.transaction('bookImages', 'readwrite');
    const store = transaction.objectStore('bookImages');
    let failure: Error | undefined;
    const completed = transactionDone(transaction, () => failure);
    for (const image of batch) {
      if (seen.has(image.id)) continue;
      seen.add(image.id);
      if (!image.id || !(image.blob instanceof Blob) || image.blob.size === 0 || !['review', 'exam', 'candidate-exam'].includes(image.kind)) {
        failure = new Error('저장할 교재 이미지가 올바르지 않습니다.');
        transaction.abort();
        break;
      }
      const existing = store.get(image.id);
      existing.onsuccess = () => { if (!existing.result) store.add(image); };
    }
    await completed;
    onProgress?.(Math.min(start + batch.length, records.length), records.length);
  }
}

/** Read only: does not upgrade the database or create book stores. */
export async function getBookImage(id: string): Promise<BookImage | undefined> {
  const database = await openDatabase();
  if (!database.objectStoreNames.contains('bookImages')) return;
  return requestResult(database.transaction('bookImages', 'readonly').objectStore('bookImages').get(id));
}

export async function saveBookImportManifest(manifest: BookImportManifest): Promise<void> {
  const database = await openBookDatabase();
  const transaction = database.transaction('bookImports', 'readwrite');
  const completed = transactionDone(transaction);
  transaction.objectStore('bookImports').put(manifest);
  await completed;
}

export async function getBookImportManifests(): Promise<BookImportManifest[]> {
  const database = await openDatabase();
  if (!database.objectStoreNames.contains('bookImports')) return [];
  return requestResult(database.transaction('bookImports', 'readonly').objectStore('bookImports').getAll());
}

/** Images must already be stored. Adds all new pending questions atomically, never overwrites. */
export async function commitBookImport(questions: Question[], manifest: BookImportManifest): Promise<{ added: number; skipped: number }> {
  const ids = new Set<string>();
  for (const question of questions) {
    if (!question.book || !question.id || ids.has(question.id)) throw new Error('교재 문항 ID가 누락되거나 중복되었습니다.');
    ids.add(question.id);
  }
  const database = await openBookDatabase();
  const transaction = database.transaction(['questionBank', 'bookImages', 'bookImports'], 'readwrite');
  const questionStore = transaction.objectStore('questionBank');
  const imageStore = transaction.objectStore('bookImages');
  let failure: Error | undefined;
  let added = 0;
  let skipped = 0;
  const completed = transactionDone(transaction, () => failure);
  const existing = new Map<string, Question>();
  const images = new Map<string, BookImage>();
  const imageIds = [...new Set(questions.flatMap((question) => [question.book!.reviewImageId, ...(question.book!.sourceQuestionImageId ? [question.book!.sourceQuestionImageId] : [])]))];
  let waiting = questions.length + imageIds.length;
  const finishLookup = () => {
    if (--waiting > 0) return;
    for (const question of questions) {
      const image = images.get(question.book!.reviewImageId);
      if (!image || image.kind !== 'review' || !(image.blob instanceof Blob) || !image.blob.size) {
        failure = new Error(`검수 원본 이미지가 저장되지 않았습니다: ${question.book!.originalId}`);
        transaction.abort();
        return;
      }
      if (question.book!.sourceQuestionImageId) {
        const candidate = images.get(question.book!.sourceQuestionImageId);
        if (!candidate || candidate.kind !== 'candidate-exam' || !(candidate.blob instanceof Blob) || !candidate.blob.size) {
          failure = new Error(`문제용 원본 이미지가 저장되지 않았습니다: ${question.book!.originalId}`);
          transaction.abort();
          return;
        }
      }
      if (existing.has(question.id)) skipped++;
    }
    for (const question of questions) {
      if (existing.has(question.id)) continue;
      questionStore.add({ ...question, status: 'pending' });
      added++;
    }
    transaction.objectStore('bookImports').put({ ...manifest, status: 'complete', counts: { ...manifest.counts, total: questions.length, added, skipped } });
  };
  for (const question of questions) {
    const request = questionStore.get(question.id);
    request.onsuccess = () => { if (request.result) existing.set(question.id, request.result); finishLookup(); };
  }
  for (const imageId of imageIds) {
    const request = imageStore.get(imageId);
    request.onsuccess = () => { if (request.result) images.set(imageId, request.result); finishLookup(); };
  }
  if (waiting === 0) {
    transaction.objectStore('bookImports').put({ ...manifest, status: 'complete', counts: { ...manifest.counts, total: 0, added: 0, skipped: 0 } });
  }
  await completed;
  return { added, skipped };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Read-only consistent snapshot. Missing stores remain empty; existing version stays unchanged. */
export async function getDeviceSnapshot(): Promise<DeviceSnapshot> {
  const database = await openDatabase();
  const names = DEVICE_STORES.map(([name]) => name).filter((name) => database.objectStoreNames.contains(name));
  const transaction = database.transaction(names, 'readonly');
  const completed = transactionDone(transaction);
  const snapshot = emptyDeviceSnapshot();
  await Promise.all(names.map(async (name) => { snapshot[name] = await requestResult(transaction.objectStore(name).getAll()); }));
  await completed;
  return snapshot;
}

/** Explicit import to an EMPTY destination only. All records commit atomically, never overwrite. */
export async function importDeviceSnapshot(snapshot: DeviceSnapshot): Promise<void> {
  const { validateDeviceSnapshot } = await import('./devicePackage');
  validateDeviceSnapshot(snapshot);
  const database = await openBookDatabase();
  const names = DEVICE_STORES.map(([name]) => name);
  const transaction = database.transaction(names, 'readwrite');
  let failure: Error | undefined;
  const completed = transactionDone(transaction, () => failure);
  let remaining = names.length;
  for (const name of names) {
    const request = transaction.objectStore(name).count();
    request.onsuccess = () => {
      if (request.result > 0) { failure = new Error('현재 주소에 저장된 자료가 있습니다. 기존 자료를 보호하기 위해 이전을 중단했습니다. 빈 새 주소에서 가져와 주세요.'); transaction.abort(); return; }
      if (--remaining !== 0) return;
      for (const [store] of DEVICE_STORES) for (const row of snapshot[store]) transaction.objectStore(store).add(row);
    };
  }
  await completed;
}

export async function getQuestions(): Promise<Question[]> {
  const database = await openDatabase();
  return requestResult(database.transaction('questionBank', 'readonly').objectStore('questionBank').getAll());
}

export async function saveQuestion(question: Question): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction('questionBank', 'readwrite').objectStore('questionBank').put(question));
}

export async function saveQuestions(questions: Question[]): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction('questionBank', 'readwrite');
  for (const question of questions) transaction.objectStore('questionBank').put(question);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function deleteQuestion(id: string): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction('questionBank', 'readwrite').objectStore('questionBank').delete(id));
}

export async function getUserData(): Promise<UserData> {
  const database = await openDatabase();
  const saved = await requestResult(database.transaction('userData', 'readonly').objectStore('userData').get('state')) as UserData | undefined;
  return saved ? { ...EMPTY_USER_DATA, ...saved } : EMPTY_USER_DATA;
}

export async function saveUserData(data: UserData): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction('userData', 'readwrite').objectStore('userData').put(data));
}

export async function getPdfSources(): Promise<PdfSource[]> {
  const database = await openDatabase();
  return requestResult(database.transaction('pdfSources', 'readonly').objectStore('pdfSources').getAll());
}

export async function getPdfSource(id: string): Promise<PdfSource | undefined> {
  const database = await openDatabase();
  return requestResult(database.transaction('pdfSources', 'readonly').objectStore('pdfSources').get(id));
}

export async function savePdfSource(source: PdfSource): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction('pdfSources', 'readwrite').objectStore('pdfSources').put(source));
}

export async function restartPdfImport(id: string): Promise<PdfSource> {
  const database = await openDatabase();
  const transaction = database.transaction(['questionBank', 'pdfSources', 'pdfDrafts', 'pdfPageTexts'], 'readwrite');
  const stores = {
    questions: transaction.objectStore('questionBank'),
    sources: transaction.objectStore('pdfSources'),
    drafts: transaction.objectStore('pdfDrafts'),
    pages: transaction.objectStore('pdfPageTexts'),
  };
  const requests = [stores.questions.getAll(), stores.sources.get(id), stores.drafts.getAll(), stores.pages.getAll()];
  const results: unknown[] = [];
  let completed = 0;
  let updated: PdfSource | undefined;
  let failure: Error | undefined;
  requests.forEach((request, index) => {
    request.onsuccess = () => {
      results[index] = request.result;
      completed++;
      if (completed !== requests.length) return;
      const source = results[1] as PdfSource | undefined;
      const drafts = (results[2] as PdfDraft[]).filter((draft) => draft.sourceId === id);
      const linkedQuestions = (results[0] as Question[]).some((question) => question.sourceDocumentId === id);
      if (!source) {
        failure = new Error('PDF 원본을 찾지 못했습니다.');
        transaction.abort();
        return;
      }
      if (linkedQuestions || drafts.some((draft) => draft.status === 'verified')) {
        failure = new Error('승인된 문항이 있어 처음부터 다시 처리할 수 없습니다. 검수 대기 상태의 PDF만 초기화할 수 있습니다.');
        transaction.abort();
        return;
      }
      updated = { ...source, lastProcessedPage: source.pageStart - 1, status: 'processing' };
      delete updated.error;
      stores.sources.put(updated);
      for (const draft of drafts) stores.drafts.delete(draft.id);
      for (const page of (results[3] as PdfPageText[])) if (page.sourceId === id) stores.pages.delete(page.id);
    };
  });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(failure ?? transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error);
  });
  if (!updated) throw new Error('PDF 재처리 상태를 저장하지 못했습니다.');
  return updated;
}

export async function createPdfImport(source: PdfSource, blob: Blob): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(['pdfSources', 'pdfFiles'], 'readwrite');
  transaction.objectStore('pdfSources').put(source);
  transaction.objectStore('pdfFiles').put({ id: source.id, blob });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function getPdfFile(id: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  const record = await requestResult(database.transaction('pdfFiles', 'readonly').objectStore('pdfFiles').get(id)) as { id: string; blob: Blob } | undefined;
  return record?.blob;
}

export async function getPdfDrafts(sourceId?: string): Promise<PdfDraft[]> {
  const database = await openDatabase();
  const rows = await requestResult(database.transaction('pdfDrafts', 'readonly').objectStore('pdfDrafts').getAll()) as PdfDraft[];
  return sourceId ? rows.filter((draft) => draft.sourceId === sourceId) : rows;
}

export async function getPdfPageTexts(sourceId: string): Promise<PdfPageText[]> {
  const database = await openDatabase();
  const rows = await requestResult(database.transaction('pdfPageTexts', 'readonly').objectStore('pdfPageTexts').getAll()) as PdfPageText[];
  return rows.filter((page) => page.sourceId === sourceId).sort((left, right) => left.sourcePage - right.sourcePage);
}

export async function savePdfDraft(draft: PdfDraft): Promise<void> {
  const database = await openDatabase();
  await requestResult(database.transaction('pdfDrafts', 'readwrite').objectStore('pdfDrafts').put(draft));
}

export async function savePdfPage(source: PdfSource, drafts: PdfDraft[], pageText: PdfPageText): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(['pdfSources', 'pdfDrafts', 'pdfPageTexts'], 'readwrite');
  transaction.objectStore('pdfSources').put(source);
  transaction.objectStore('pdfPageTexts').put(pageText);
  const draftStore = transaction.objectStore('pdfDrafts');
  for (const draft of drafts) draftStore.put(draft);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function approvePdfDraft(question: Question, draftId: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(['questionBank', 'pdfDrafts'], 'readwrite');
  const draftStore = transaction.objectStore('pdfDrafts');
  const lookup = draftStore.get(draftId);
  let failure: Error | undefined;
  lookup.onsuccess = () => {
    const draft = lookup.result as PdfDraft | undefined;
    if (!draft || draft.status !== 'pending') {
      failure = new Error('검수 대기 문항을 찾지 못했습니다. 새로고침 후 다시 확인해 주세요.');
      transaction.abort();
      return;
    }
    transaction.objectStore('questionBank').put(question);
    draftStore.put({ ...draft, status: 'verified' });
  };
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(failure ?? transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error);
  });
}

export async function clearPdfImports(): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(['pdfSources', 'pdfFiles', 'pdfDrafts', 'pdfPageTexts'], 'readwrite');
  transaction.objectStore('pdfSources').clear();
  transaction.objectStore('pdfFiles').clear();
  transaction.objectStore('pdfDrafts').clear();
  transaction.objectStore('pdfPageTexts').clear();
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function deletePdfImport(id: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(['questionBank', 'pdfSources', 'pdfFiles', 'pdfDrafts', 'pdfPageTexts'], 'readwrite');
  const questionStore = transaction.objectStore('questionBank');
  const draftStore = transaction.objectStore('pdfDrafts');
  const pageTextStore = transaction.objectStore('pdfPageTexts');
  const requests = [questionStore.getAll(), draftStore.getAll(), pageTextStore.getAll()];
  let completed = 0;
  let failure: Error | undefined;
  const results: unknown[][] = [];
  requests.forEach((request, index) => {
    request.onsuccess = () => {
      results[index] = request.result as unknown[];
      completed++;
      if (completed !== requests.length) return;
      const linked = (results[0] as Question[]).some((question) => question.sourceDocumentId === id);
      if (linked) {
        failure = new Error('문제은행에 승인된 문항이 이 PDF 원본을 참조합니다. 승인 문항을 삭제하거나 원본 연결을 정리한 뒤 다시 시도해 주세요.');
        transaction.abort();
        return;
      }
      transaction.objectStore('pdfSources').delete(id);
      transaction.objectStore('pdfFiles').delete(id);
      for (const draft of results[1] as PdfDraft[]) if (draft.sourceId === id) draftStore.delete(draft.id);
      for (const page of results[2] as PdfPageText[]) if (page.sourceId === id) pageTextStore.delete(page.id);
    };
  });
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(failure ?? transaction.error);
    transaction.onabort = () => reject(failure ?? transaction.error);
  });
}
