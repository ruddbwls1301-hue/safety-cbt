import { crc32, readZipDirectory, readZipEntry } from './bookArchive';
import { sha256Hex } from './browserCrypto';
import { parseQuestionBackup } from './questions';

export const DEVICE_STORES = [['questionBank', 'id'], ['userData', 'key'], ['pdfSources', 'id'], ['pdfFiles', 'id'], ['pdfDrafts', 'id'], ['pdfPageTexts', 'id'], ['bookImages', 'id'], ['bookImports', 'importId']] as const;
export type DeviceStore = typeof DEVICE_STORES[number][0];
export type DeviceSnapshot = Record<DeviceStore, Record<string, unknown>[]>;
type Part = { path: string; size: number; sha256: string };
type PackedBlob = { cbtBlob: true; type: string; size: number; parts: Part[] };
type Entry = { path: string; blob: Blob; crc: number };
export type TransferProgress = (done: number, total: number) => void;
const MAX_TOTAL = 512 * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;
const encoder = new TextEncoder();

// Background Safari tabs throttle timers. A message task keeps large local
// exports responsive without depending on a foreground timer budget.
function yieldTransfer(): Promise<void> {
  if (typeof MessageChannel === 'undefined') return new Promise((resolve) => setTimeout(resolve, 0));
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); };
    channel.port2.postMessage(null);
  });
}

export function emptyDeviceSnapshot(): DeviceSnapshot {
  return { questionBank: [], userData: [], pdfSources: [], pdfFiles: [], pdfDrafts: [], pdfPageTexts: [], bookImages: [], bookImports: [] };
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('이전 파일의 데이터 구조가 올바르지 않습니다.');
  return value as Record<string, unknown>;
}

/** Validate only. Never normalize IDs, infer answers, approve, or downgrade source records. */
export function validateDeviceSnapshot(snapshot: DeviceSnapshot): void {
  for (const [name, key] of DEVICE_STORES) {
    if (!Array.isArray(snapshot[name])) throw new Error(`이전 파일의 ${name} 자료가 없습니다.`);
    const seen = new Set<string>();
    for (const raw of snapshot[name]) {
      const row = object(raw); const id = row[key];
      if (typeof id !== 'string' || !id || seen.has(id)) throw new Error(`${name}의 ID가 누락되거나 중복되었습니다.`);
      seen.add(id);
      if ((name === 'bookImages' || name === 'pdfFiles') && (!(row.blob instanceof Blob) || row.blob.size === 0)) throw new Error(`${name} 원본 파일이 없습니다.`);
      if (name === 'bookImages' && !['review', 'exam', 'candidate-exam'].includes(String(row.kind))) throw new Error('교재 이미지 종류가 올바르지 않습니다.');
    }
  }
  parseQuestionBackup(snapshot.questionBank);
  if (snapshot.userData.length > 1) throw new Error('학습기록이 중복되었습니다.');
  for (const user of snapshot.userData) {
    if (user.key !== 'state' || !Array.isArray(user.attempts) || !Array.isArray(user.bookmarks) || !['light', 'dark'].includes(String(user.theme))) throw new Error('학습기록 구조가 올바르지 않습니다.');
    if (user.bookmarks.some((id) => typeof id !== 'string')) throw new Error('북마크 ID를 확인해 주세요.');
    const checkStudy = (value: unknown, active: boolean) => {
      const study = object(value);
      if (typeof study.id !== 'string' || typeof study.title !== 'string' || !['legacy', 'revised'].includes(String(study.scheme)) || !['random', 'subject', 'round', 'wrong', 'bookmarked', 'book-round'].includes(String(study.mode))
        || !Array.isArray(study.questionIds) || study.questionIds.some((id) => typeof id !== 'string') || typeof study.startedAt !== 'string' || !Number.isFinite(Date.parse(study.startedAt))) throw new Error('응시 기록의 구조를 확인해 주세요.');
      const answers = object(study.answers);
      if (Object.values(answers).some((answer) => typeof answer !== 'number' || !Number.isInteger(answer) || answer < 1 || answer > 4)) throw new Error('응시 기록의 답안 번호를 확인해 주세요.');
      if (active ? !Number.isFinite(study.deadlineAt) || !Number.isInteger(study.index) || Number(study.index) < 0 || Number(study.index) >= study.questionIds.length || !Array.isArray(study.markedIds)
        : typeof study.submittedAt !== 'string' || !Number.isFinite(Date.parse(study.submittedAt)) || !Number.isFinite(study.remainingSeconds)) throw new Error('응시 기록의 시간·문제 위치를 확인해 주세요.');
    };
    user.attempts.forEach((study) => checkStudy(study, false));
    if (user.activeSession !== undefined) checkStudy(user.activeSession, true);
    if (user.savedSessions !== undefined) { if (!Array.isArray(user.savedSessions)) throw new Error('저장한 학습 목록을 확인해 주세요.'); user.savedSessions.forEach((study) => checkStudy(study, true)); }
  }
  const images = new Map(snapshot.bookImages.map((row) => [row.id, row]));
  for (const q of snapshot.questionBank) {
    if (!q.book) continue;
    const book = object(q.book);
    for (const [field, kind] of [['reviewImageId', 'review'], ['sourceQuestionImageId', 'candidate-exam'], ['examImageId', 'exam']] as const) {
      const id = book[field];
      if (id && images.get(id)?.kind !== kind) throw new Error(`문항의 ${field} 이미지 연결이 누락되었습니다: ${q.id}`);
    }
  }
}

/** Stored ZIP, binary Blob parts, no base64 and no external calls. */
function zip(entries: Entry[]): Blob {
  const files: BlobPart[] = []; const central: BlobPart[] = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.path); const header = new Uint8Array(30); const h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true);
    h.setUint32(14, entry.crc, true); h.setUint32(18, entry.blob.size, true); h.setUint32(22, entry.blob.size, true); h.setUint16(26, name.length, true);
    files.push(header, name, entry.blob);
    const record = new Uint8Array(46); const c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint32(16, entry.crc, true); c.setUint32(20, entry.blob.size, true); c.setUint32(24, entry.blob.size, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(record, name); offset += header.length + name.length + entry.blob.size;
  }
  const directory = new Blob(central); const end = new Uint8Array(22); const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, directory.size, true); e.setUint32(16, offset, true);
  return new Blob([...files, directory, end], { type: 'application/zip' });
}

export async function createDevicePackage(snapshot: DeviceSnapshot, progress?: TransferProgress): Promise<Blob> {
  validateDeviceSnapshot(snapshot);
  const packed = emptyDeviceSnapshot(); const entries: Entry[] = [];
  const total = DEVICE_STORES.reduce((sum, [name]) => sum + snapshot[name].length, 0);
  let done = 0; let binarySize = 0;
  for (const [name] of DEVICE_STORES) for (const row of snapshot[name]) {
    const copy = { ...row };
    if (row.blob instanceof Blob) {
      const blob = row.blob;
      binarySize += blob.size;
      if (binarySize > MAX_TOTAL - 16 * 1024 * 1024) throw new Error('이전 파일은 전체 496MB까지 지원합니다. 기존 자료는 변경하지 않았습니다.');
      const parts: Part[] = [];
      for (let start = 0; start < blob.size; start += CHUNK) {
        const part = blob.slice(start, start + CHUNK); const bytes = new Uint8Array(await part.arrayBuffer());
        const path = `binary/${entries.length}.bin`;
        parts.push({ path, size: part.size, sha256: await sha256Hex(bytes) });
        entries.push({ path, blob: part, crc: crc32(bytes) });
      }
      copy.blob = { cbtBlob: true, type: blob.type, size: blob.size, parts } satisfies PackedBlob;
    }
    packed[name].push(copy); progress?.(++done, total);
    if (done % 20 === 0) await yieldTransfer();
  }
  const bytes = encoder.encode(JSON.stringify({ format: 'industrial-safety-device-package', version: 1, exportedAt: new Date().toISOString(), records: packed }));
  if (bytes.length > 16 * 1024 * 1024) throw new Error('이전 파일의 메타데이터가 너무 큽니다. 기존 자료는 변경하지 않았습니다.');
  entries.unshift({ path: 'device-package.json', blob: new Blob([bytes]), crc: crc32(bytes) });
  if (entries.length >= 65535) throw new Error('이전 파일 항목 수가 지원 범위를 초과합니다.');
  return zip(entries);
}

/** Fully inspect into memory before any destination writes. */
export async function inspectDevicePackage(file: Blob, progress?: TransferProgress): Promise<DeviceSnapshot> {
  const entries = await readZipDirectory(file); const metadata = entries.get('device-package.json');
  if (!metadata || metadata.size > 16 * 1024 * 1024) throw new Error('CBT 기기 이전 파일이 아닙니다.');
  const manifest = object(JSON.parse(new TextDecoder().decode(await readZipEntry(file, metadata))));
  if (manifest.format !== 'industrial-safety-device-package' || manifest.version !== 1) throw new Error('지원하지 않는 기기 이전 파일입니다.');
  const records = object(manifest.records); const snapshot = emptyDeviceSnapshot();
  const usedParts = new Set<string>();
  let done = 0; const total = DEVICE_STORES.reduce((sum, [name]) => sum + (Array.isArray(records[name]) ? records[name].length : 0), 0);
  for (const [name] of DEVICE_STORES) {
    if (!Array.isArray(records[name])) throw new Error(`이전 파일의 ${name} 자료가 없습니다.`);
    for (const raw of records[name]) {
      const row = { ...object(raw) };
      if (name === 'bookImages' || name === 'pdfFiles') {
        const packed = object(row.blob);
        if (packed.cbtBlob !== true || typeof packed.type !== 'string' || !Array.isArray(packed.parts) || packed.parts.length > entries.size || !Number.isSafeInteger(packed.size) || Number(packed.size) <= 0 || Number(packed.size) > MAX_TOTAL) throw new Error('원본 파일 구조가 올바르지 않습니다.');
        const parts: Blob[] = [];
        for (const value of packed.parts) {
          const part = object(value);
          if (typeof part.path !== 'string' || !/^binary\/\d+\.bin$/.test(part.path) || usedParts.has(part.path)) throw new Error('원본 파일 경로가 올바르지 않거나 중복되었습니다.');
          usedParts.add(part.path);
          const entry = entries.get(part.path);
          if (!entry || entry.size !== part.size) throw new Error('이전 파일에 이미지/PDF가 누락되었습니다.');
          const bytes = await readZipEntry(file, entry);
          if (await sha256Hex(bytes) !== part.sha256) throw new Error('이전 파일의 이미지/PDF 검증에 실패했습니다.');
          parts.push(new Blob([bytes]));
        }
        const blob = new Blob(parts, { type: packed.type });
        if (!blob.size || blob.size !== packed.size) throw new Error('원본 파일 크기가 올바르지 않습니다.');
        row.blob = blob;
      }
      snapshot[name].push(row); progress?.(++done, total);
      if (done % 20 === 0) await yieldTransfer();
    }
  }
  validateDeviceSnapshot(snapshot);
  return snapshot;
}
