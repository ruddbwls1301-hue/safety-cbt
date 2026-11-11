import { afterEach, describe, expect, it, vi } from 'vitest';
import { crc32, inspectBookArchive, normalizeZipPath, readBookImage, readZipDirectory, readZipEntry, resolveBookImageEntry } from './bookArchive';
import { autoApproveBookQuestions, convertBookData, isBookQuestionEligible } from './bookData';

const encoder = new TextEncoder();
type SyntheticEntry = { name: string; nameBytes?: Uint8Array; bytes: Uint8Array; method?: 0 | 8; compressed?: Uint8Array; crc?: number; declaredSize?: number; flags?: number };
function concatenate(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) { result.set(part, cursor); cursor += part.length; }
  return result;
}
function rawDeflate(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 65535) throw new Error('Synthetic DEFLATE fixture too long');
  // A final uncompressed DEFLATE block is still a method 8 ZIP member.
  return concatenate([new Uint8Array([1, bytes.length & 255, bytes.length >>> 8, (~bytes.length) & 255, ((~bytes.length) >>> 8) & 255]), bytes]);
}
function makeZip(entries: SyntheticEntry[], comment = ''): File {
  const locals: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = entry.nameBytes ?? encoder.encode(entry.name);
    const method = entry.method ?? 0;
    const data = entry.compressed ?? (method === 8 ? rawDeflate(entry.bytes) : entry.bytes);
    const crc = entry.crc ?? crc32(entry.bytes);
    const flags = entry.flags ?? 0x800;
    const size = entry.declaredSize ?? entry.bytes.length;
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, flags, true);
    localView.setUint16(8, method, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, size, true);
    localView.setUint16(26, name.length, true);
    locals.push(local, name, data);
    const central = new Uint8Array(46);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(4, 20, true);
    view.setUint16(6, 20, true);
    view.setUint16(8, flags, true);
    view.setUint16(10, method, true);
    view.setUint32(16, crc, true);
    view.setUint32(20, data.length, true);
    view.setUint32(24, size, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, localOffset, true);
    directory.push(central, name);
    localOffset += local.length + name.length + data.length;
  }
  const central = concatenate(directory);
  const commentBytes = encoder.encode(comment);
  const end = new Uint8Array(22);
  const view = new DataView(end.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, entries.length, true);
  view.setUint16(10, entries.length, true);
  view.setUint32(12, central.length, true);
  view.setUint32(16, localOffset, true);
  view.setUint16(20, commentBytes.length, true);
  return new File([concatenate([...locals, central, end, commentBytes])], 'synthetic.zip', { type: 'application/zip' });
}
function syntheticData() {
  return { meta: { title: '합성 검증 자료' }, questions: [{ id: 'synthetic-only', section: 1, subjectNo: 1, subject: '산업재해 예방 및 안전보건교육', no: 12, frequency: 2, examRound: null, question: '합성 검증 지문', choices: ['가', '나', '다', '라'], answer: 2, answerSource: 'manual_visual_check', explanation: '합성 검증 해설', explanationRef: null, image: 'images/synthetic-only.jpg', source: { page: 1, spans: [{ page: 1, column: 'L', y0: 0.1, y1: 0.5 }] }, reviewFlags: [] }] };
}
afterEach(() => vi.unstubAllGlobals());
const archivePath = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CBT_ARCHIVE_READ_ONLY;

describe('native ZIP book inspection', () => {
  it('matches the standard CRC-32 check vector', () => {
    expect(crc32(encoder.encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('reads stored and genuinely compressed raw DEFLATE members, including an EOCD comment', async () => {
    const file = makeZip([
      { name: 'odd-root/stored.txt', bytes: encoder.encode('stored') },
      { name: 'odd-root/deflated.txt', bytes: encoder.encode('hello'), method: 8, compressed: new Uint8Array([0xcb, 0x48, 0xcd, 0xc9, 0xc9, 0x07, 0x00]) },
    ], 'comment with PK marker');
    const entries = await readZipDirectory(file);
    expect([...entries.keys()]).toEqual(['odd-root/stored.txt', 'odd-root/deflated.txt']);
    expect(new TextDecoder().decode(await readZipEntry(file, entries.get('odd-root/stored.txt')!))).toBe('stored');
    expect(new TextDecoder().decode(await readZipEntry(file, entries.get('odd-root/deflated.txt')!))).toBe('hello');
  });

  it('rejects CRC corruption and misleading declared decompressed lengths', async () => {
    const corrupted = makeZip([{ name: 'bad.txt', bytes: encoder.encode('changed'), crc: crc32(encoder.encode('original')) }]);
    await expect(readZipEntry(corrupted, (await readZipDirectory(corrupted)).get('bad.txt')!)).rejects.toThrow('CRC');
    const inflated = makeZip([{ name: 'bad-size.txt', bytes: encoder.encode('too long'), method: 8, declaredSize: 2 }]);
    await expect(readZipEntry(inflated, (await readZipDirectory(inflated)).get('bad-size.txt')!)).rejects.toThrow('실제 크기');
  });

  it('rejects traversal, absolute paths, duplicate normalized paths and encrypted members', async () => {
    for (const path of ['../questions.json', 'root/../questions.json', '/questions.json', 'C:\\questions.json', 'root\u0000/questions.json']) expect(() => normalizeZipPath(path)).toThrow('안전하지');
    await expect(readZipDirectory(makeZip([{ name: 'root/../questions.json', bytes: encoder.encode('{}') }]))).rejects.toThrow('안전하지');
    await expect(readZipDirectory(makeZip([{ name: 'root/file.txt', bytes: new Uint8Array() }, { name: 'root/./file.txt', bytes: new Uint8Array() }]))).rejects.toThrow('중복');
    await expect(readZipDirectory(makeZip([{ name: 'secret.txt', bytes: new Uint8Array(), flags: 1 }]))).rejects.toThrow('암호화');
  });

  it('locates questions.json under an arbitrary folder and inspects without any IndexedDB operation', async () => {
    const open = vi.fn(() => { throw new Error('Inspection must not open IndexedDB'); });
    const deleteDatabase = vi.fn(() => { throw new Error('Inspection must not mutate IndexedDB'); });
    vi.stubGlobal('indexedDB', { open, deleteDatabase });
    const prefix = '예상하지 않은 폴더/nested/';
    const bytes = encoder.encode(JSON.stringify(syntheticData()));
    const file = makeZip([{ name: `${prefix}questions.json`, bytes, method: 8, flags: 0 }, { name: `${prefix}images/synthetic-only.jpg`, bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) }]);
    const progress: string[] = [];
    const archive = await inspectBookArchive(file, (message) => progress.push(message));
    expect(archive.basePath).toBe(prefix);
    expect(archive.jsonPath).toBe(`${prefix}questions.json`);
    expect(archive.report).toMatchObject({ total: 1, pending: 1, unknownYears: 1, imageCount: 1, missingImages: [], fatalErrors: [] });
    expect(archive.sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(progress).toHaveLength(3);
    const image = await readBookImage(archive, 'images/synthetic-only.jpg');
    expect(image.type).toBe('image/jpeg');
    expect(Array.from(new Uint8Array(await image.arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0xd9]);
    await expect(readBookImage(archive, '../leak.jpg')).rejects.toThrow('안전하지');
    expect(open).not.toHaveBeenCalled();
    expect(deleteDatabase).not.toHaveBeenCalled();
  });

  it('refuses ambiguous sources, malformed JSON, and non-image bytes masquerading as JPG', async () => {
    const data = encoder.encode(JSON.stringify(syntheticData()));
    await expect(inspectBookArchive(makeZip([{ name: 'one/questions.json', bytes: data }, { name: 'two/questions.json', bytes: data }]))).rejects.toThrow('여러 개');
    await expect(inspectBookArchive(makeZip([{ name: 'questions.json', bytes: encoder.encode('{broken') }]))).rejects.toThrow();
    const archive = await inspectBookArchive(makeZip([{ name: 'questions.json', bytes: data }, { name: 'images/synthetic-only.jpg', bytes: encoder.encode('not an image') }]));
    await expect(readBookImage(archive, 'images/synthetic-only.jpg')).rejects.toThrow('지원하지 않는 이미지');
  });

  it('resolves new image roles by exact relative path under the JSON root, including unflagged legacy folder bytes', async () => {
    const data = syntheticData();
    const raw = data.questions[0] as Record<string, unknown>;
    delete raw.image;
    raw.explanationImage = 'images/synthetic-only.jpg';
    raw.questionImage = 'images_question/synthetic-only.jpg';
    const legacyPrefix = new Uint8Array([0x82, 0x83, 0x2f]); // Intentionally not valid UTF-8.
    const withPrefix = (suffix: string) => concatenate([legacyPrefix, encoder.encode(suffix)]);
    const archive = await inspectBookArchive(makeZip([
      { name: 'legacy/questions.json', nameBytes: withPrefix('questions.json'), bytes: encoder.encode(JSON.stringify(data)), flags: 0 },
      { name: 'legacy/images/synthetic-only.jpg', nameBytes: withPrefix('images/synthetic-only.jpg'), bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x01]), flags: 0 },
      { name: 'legacy/images_question/synthetic-only.jpg', nameBytes: withPrefix('images_question/synthetic-only.jpg'), bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x02]), flags: 0 },
      { name: 'unrelated/images/synthetic-only.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x03]) },
    ]));
    expect(archive.report).toMatchObject({ imageCount: 2, questionImageCandidates: 1, missingImages: [] });
    expect(resolveBookImageEntry(archive, 'images/synthetic-only.jpg').name).toBe(`${archive.basePath}images/synthetic-only.jpg`);
    expect(resolveBookImageEntry(archive, 'images_question/synthetic-only.jpg').name).toBe(`${archive.basePath}images_question/synthetic-only.jpg`);
    expect(Array.from(new Uint8Array(await (await readBookImage(archive, 'images/synthetic-only.jpg')).arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0x01]);
    expect(Array.from(new Uint8Array(await (await readBookImage(archive, 'images_question/synthetic-only.jpg')).arrayBuffer()))).toEqual([0xff, 0xd8, 0xff, 0x02]);
    expect(() => resolveBookImageEntry(archive, 'synthetic-only.jpg')).toThrow('이미지가 없습니다');
    expect(() => resolveBookImageEntry(archive, '../unrelated/images/synthetic-only.jpg')).toThrow('안전하지');
  });

  it.runIf(Boolean(archivePath))('optionally inspects the supplied local ZIP without extracting or storing its contents', async () => {
    const nodeFileModule = 'node:fs/promises';
    const fs = await import(nodeFileModule);
    const bytes: Uint8Array = await fs.readFile(archivePath!);
    const open = vi.fn(() => { throw new Error('Read-only archive check must not access IndexedDB'); });
    vi.stubGlobal('indexedDB', { open });
    const archive = await inspectBookArchive(new File([new Uint8Array(bytes)], 'local-read-only.zip'));
    expect(archive.report.fatalErrors).toEqual([]);
    expect(archive.report.missingImages).toEqual([]);
    expect(open).not.toHaveBeenCalled();
    const automatic = autoApproveBookQuestions(convertBookData(archive.parsed), archive.sha256);
    expect(automatic.approved.every((question) => isBookQuestionEligible(question, automatic.questions))).toBe(true);
    expect(automatic.approved.every((question) => !question.book!.review.sourceCompared)).toBe(true);
    expect(open).not.toHaveBeenCalled();
    console.info(JSON.stringify({ sha256: archive.sha256, bytes: bytes.length, total: archive.report.total, unknownYears: archive.report.unknownYears, subjects: archive.report.subjects, exams: archive.report.exams, blankChoices: archive.report.blankChoices, graphics: archive.report.graphics, questionImages: archive.report.questionImages, formula: archive.report.formula, flags: archive.report.flags, referenceErrors: archive.report.referenceErrors, imageCount: archive.report.imageCount, automaticEligible: automatic.approved.length, manualPending: automatic.pending.length, automaticReasons: automatic.reasonCounts, examExplanationsUnavailable: automatic.approved.filter((question) => question.book!.review.automatic?.explanationUnavailable).length }));
  }, 30000);
});
