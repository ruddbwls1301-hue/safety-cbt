import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createDevicePackage, DEVICE_STORES, emptyDeviceSnapshot, inspectDevicePackage, validateDeviceSnapshot } from './devicePackage';
import { readZipDirectory } from './bookArchive';
import { sha256Hex } from './browserCrypto';

function fixture() {
  const s = emptyDeviceSnapshot();
  s.questionBank.push({ id: 'portable-fixture-q', year: null, round: '', originalSubject: '산업재해 예방 및 안전보건교육', prompt: '합성 이전 검증', choices: ['가','나','다','라'], answer: 2, explanation: '합성 해설', status: 'verified', createdAt: '2026-10-12T00:00:00Z' });
  const attempt = { id: 'portable-fixture-attempt', title: '합성 기록', scheme: 'legacy', mode: 'subject', questionIds: ['portable-fixture-q'], answers: { 'portable-fixture-q': 2 }, startedAt: '2026-10-12T00:00:00Z', submittedAt: '2026-10-12T00:01:00Z', remainingSeconds: 30 };
  s.userData.push({ key: 'state', attempts: [attempt], bookmarks: ['portable-fixture-q'], theme: 'dark' });
  s.bookImages.push({ id: 'portable-fixture-image', kind: 'exam', createdAt: '2026-10-12T00:00:00Z', blob: new Blob(['synthetic-image-bytes'], { type: 'image/png' }) });
  s.pdfFiles.push({ id: 'portable-fixture-pdf', blob: new Blob(['synthetic-pdf-bytes'], { type: 'application/pdf' }) });
  return s;
}

describe('portable device package', () => {
  it('round trips IDs, approval, user records and original binary data without base64', async () => {
    const s = fixture(); const before = structuredClone(s.questionBank);
    const file = await createDevicePackage(s); const restored = await inspectDevicePackage(file);
    expect(restored.questionBank).toEqual(before); expect(restored.userData).toEqual(s.userData);
    expect(restored.bookImages[0].id).toBe('portable-fixture-image');
    expect((restored.bookImages[0].blob as Blob).type).toBe('image/png');
    expect(await (restored.bookImages[0].blob as Blob).text()).toBe('synthetic-image-bytes');
    expect(await (restored.pdfFiles[0].blob as Blob).text()).toBe('synthetic-pdf-bytes');
    expect(s.questionBank).toEqual(before);
    expect([...await readZipDirectory(file)].map(([path]) => path)).toContain('binary/0.bin');
  });
  it('chunks a large binary file while preserving its exact bytes', async () => {
    const s = emptyDeviceSnapshot(); const bytes = new Uint8Array(8 * 1024 * 1024 + 7); bytes[0] = 123; bytes[bytes.length - 1] = 45;
    s.pdfFiles.push({ id: 'large-fixture', blob: new Blob([bytes], { type: 'application/pdf' }) });
    const file = await createDevicePackage(s); const restored = await inspectDevicePackage(file);
    expect((await readZipDirectory(file)).size).toBe(3);
    expect(await sha256Hex(await (restored.pdfFiles[0].blob as Blob).arrayBuffer())).toBe(await sha256Hex(bytes));
  });
  it('rejects damaged binaries before any destination write', async () => {
    const file = await createDevicePackage(fixture()); const bytes = new Uint8Array(await file.arrayBuffer());
    const entry = (await readZipDirectory(file)).get('binary/0.bin')!;
    const view = new DataView(bytes.buffer); const dataOffset = entry.localOffset + 30 + view.getUint16(entry.localOffset + 26, true) + view.getUint16(entry.localOffset + 28, true);
    bytes[dataOffset] ^= 1;
    await expect(inspectDevicePackage(new Blob([bytes]))).rejects.toThrow('CRC');
  });
  it('round trips 2580 synthetic questions and 5160 binary images with progress', async () => {
    const s = fixture(); const question = s.questionBank[0]; const blob = s.bookImages[0].blob;
    for (let i = 1; i < 2580; i++) s.questionBank.push({ ...question, id: `synthetic-scale-q-${i}` });
    for (let i = 1; i < 5160; i++) s.bookImages.push({ id: `synthetic-scale-image-${i}`, kind: 'exam', blob });
    const progress = vi.fn();
    const restored = await inspectDevicePackage(await createDevicePackage(s, progress), progress);
    expect(restored.questionBank).toEqual(s.questionBank);
    expect(restored.bookImages).toHaveLength(5160);
    expect(restored.userData).toEqual(s.userData);
    expect(await (restored.bookImages[5159].blob as Blob).text()).toBe('synthetic-image-bytes');
    expect(progress).toHaveBeenCalledWith(7742, 7742);
  }, 20000);
  it('rejects duplicate IDs and invalid saved answers without mutating the source', () => {
    const s = fixture(); s.questionBank.push({ ...s.questionBank[0] });
    expect(() => validateDeviceSnapshot(s)).toThrow('중복');
    const broken = fixture(); (broken.userData[0].attempts as { answers: Record<string, number> }[])[0].answers['portable-fixture-q'] = 7;
    expect(() => validateDeviceSnapshot(broken)).toThrow('답안');
  });
  it('rejects missing book image references', () => {
    const s = fixture(); s.questionBank[0].book = { reviewImageId: 'missing-review' };
    expect(() => validateDeviceSnapshot(s)).toThrow('이미지 연결');
  });
});

describe('atomic import to a new origin only', () => {
  beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); vi.resetModules(); });
  it('imports an empty v4 destination once and refuses to overwrite it', async () => {
    const { importDeviceSnapshot, getDeviceSnapshot } = await import('./db'); const source = fixture();
    await importDeviceSnapshot(source);
    const imported = await getDeviceSnapshot(); expect(imported.questionBank).toEqual(source.questionBank); expect(imported.userData).toEqual(source.userData);
    await expect(importDeviceSnapshot(emptyDeviceSnapshot())).rejects.toThrow('기존');
    expect((await getDeviceSnapshot()).questionBank).toEqual(source.questionBank);
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('industrial-safety-cbt'); r.onsuccess = () => resolve(r.result); });
    expect(db.version).toBe(4); expect([...db.objectStoreNames]).toEqual(DEVICE_STORES.map(([name]) => name).sort()); db.close();
  });
  it('keeps an existing v4 bank and learning records intact when an import is refused', async () => {
    const { importDeviceSnapshot, getDeviceSnapshot } = await import('./db'); const old = fixture();
    await importDeviceSnapshot(old); const next = fixture(); next.questionBank[0].id = 'different-fixture';
    await expect(importDeviceSnapshot(next)).rejects.toThrow('자료가 있습니다');
    const retained = await getDeviceSnapshot(); expect(retained.questionBank).toEqual(old.questionBank); expect(retained.userData).toEqual(old.userData);
  });
  it('does not upgrade a v3 database during read-only export', async () => {
    const r = indexedDB.open('industrial-safety-cbt', 3);
    r.onupgradeneeded = () => DEVICE_STORES.filter(([name]) => !['bookImages','bookImports'].includes(name)).forEach(([name,key]) => r.result.createObjectStore(name,{keyPath:key}));
    const db = await new Promise<IDBDatabase>((resolve) => { r.onsuccess = () => resolve(r.result); });
    const { getDeviceSnapshot } = await import('./db'); const snapshot = await getDeviceSnapshot();
    expect(snapshot.bookImages).toEqual([]); expect(db.version).toBe(3); expect(db.objectStoreNames.length).toBe(6); db.close();
  });
});
