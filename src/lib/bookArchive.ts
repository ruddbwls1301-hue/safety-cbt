import { inspectBookData, type BookInspectionReport } from './bookData';
import { sha256Hex } from './browserCrypto';

export type ZipEntry = { name: string; flags: number; method: number; crc: number; compressedSize: number; size: number; localOffset: number };
export type BookArchive = {
  file: File;
  entries: Map<string, ZipEntry>;
  jsonPath: string;
  basePath: string;
  imageEntries: Map<string, ZipEntry>;
  parsed: unknown;
  report: BookInspectionReport;
  sha256: string;
};
const MAX_ENTRY = 64 * 1024 * 1024;
const MAX_TOTAL = 512 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function decodePath(bytes: Uint8Array): string {
  // Some archives omit the UTF-8 flag even though the Korean folder bytes are UTF-8.
  // We only locate the ASCII basename; the top folder's spelling is irrelevant.
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch { return new TextDecoder('windows-1252').decode(bytes); }
}
export function normalizeZipPath(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-z]:/i.test(normalized) || normalized.includes('\0') || normalized.split('/').includes('..')) throw new Error('안전하지 않은 ZIP 파일 경로가 있습니다.');
  return normalized.split('/').filter((part) => part && part !== '.').join('/');
}
export async function readZipDirectory(file: Blob): Promise<Map<string, ZipEntry>> {
  const tailOffset = Math.max(0, file.size - 65557);
  const tail = new DataView(await file.slice(tailOffset).arrayBuffer());
  let end = -1;
  for (let index = tail.byteLength - 22; index >= 0; index--) {
    if (tail.getUint32(index, true) === 0x06054b50 && index + 22 + tail.getUint16(index + 20, true) === tail.byteLength) { end = index; break; }
  }
  if (end < 0) throw new Error('ZIP 중앙 디렉터리를 찾지 못했습니다.');
  if (tail.getUint16(end + 4, true) || tail.getUint16(end + 6, true)) throw new Error('분할 ZIP은 지원하지 않습니다.');
  const count = tail.getUint16(end + 10, true);
  const size = tail.getUint32(end + 12, true);
  const offset = tail.getUint32(end + 16, true);
  if (count === 65535 || offset === 0xffffffff || size === 0xffffffff) throw new Error('ZIP64는 지원하지 않습니다.');
  if (offset + size > file.size || size > 16 * 1024 * 1024) throw new Error('ZIP 목록 크기가 올바르지 않습니다.');
  const directoryBytes = new Uint8Array(await file.slice(offset, offset + size).arrayBuffer());
  const view = new DataView(directoryBytes.buffer);
  const entries = new Map<string, ZipEntry>();
  let cursor = 0;
  let total = 0;
  for (let index = 0; index < count; index++) {
    if (cursor + 46 > view.byteLength || view.getUint32(cursor, true) !== 0x02014b50) throw new Error('ZIP 목록이 손상되었습니다.');
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const next = cursor + 46 + nameLength + extraLength + commentLength;
    if (next > view.byteLength) throw new Error('ZIP 파일명이 손상되었습니다.');
    const rawName = decodePath(directoryBytes.subarray(cursor + 46, cursor + 46 + nameLength));
    const name = normalizeZipPath(rawName);
    if (rawName.endsWith('/')) { cursor = next; continue; }
    if (entries.has(name)) throw new Error(`ZIP 경로가 중복되었습니다: ${name}`);
    const entry: ZipEntry = { name, flags: view.getUint16(cursor + 8, true), method: view.getUint16(cursor + 10, true), crc: view.getUint32(cursor + 16, true), compressedSize: view.getUint32(cursor + 20, true), size: view.getUint32(cursor + 24, true), localOffset: view.getUint32(cursor + 42, true) };
    total += entry.size;
    if (entry.size > MAX_ENTRY || total > MAX_TOTAL) throw new Error('압축 해제 데이터가 지원 크기를 초과합니다.');
    if ((entry.flags & 1) || ![0, 8].includes(entry.method)) throw new Error('암호화되었거나 지원하지 않는 압축 방식입니다.');
    entries.set(name, entry);
    cursor = next;
  }
  return entries;
}
export async function readZipEntry(file: Blob, entry: ZipEntry): Promise<Uint8Array> {
  const header = new DataView(await file.slice(entry.localOffset, entry.localOffset + 30).arrayBuffer());
  if (header.byteLength !== 30 || header.getUint32(0, true) !== 0x04034b50) throw new Error(`ZIP 항목이 손상되었습니다: ${entry.name}`);
  const start = entry.localOffset + 30 + header.getUint16(26, true) + header.getUint16(28, true);
  if (start + entry.compressedSize > file.size) throw new Error(`ZIP 항목 범위가 올바르지 않습니다: ${entry.name}`);
  const compressed = file.slice(start, start + entry.compressedSize);
  let bytes: Uint8Array;
  if (entry.method === 0) bytes = new Uint8Array(await compressed.arrayBuffer());
  else {
    let decoder: DecompressionStream;
    try { decoder = new DecompressionStream('deflate-raw'); }
    catch { throw new Error('이 브라우저는 ZIP 압축 해제를 지원하지 않습니다. 최신 Chrome, Edge 또는 Safari에서 다시 시도해 주세요. 저장된 데이터는 변경되지 않았습니다.'); }
    const reader = compressed.stream().pipeThrough(decoder).getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) break;
        length += result.value.length;
        if (length > entry.size || length > MAX_ENTRY) throw new Error('ZIP 항목의 실제 크기가 목록과 다릅니다.');
        chunks.push(result.value);
      }
    } finally { await reader.cancel().catch(() => undefined); }
    bytes = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.length; }
  }
  if (bytes.length !== entry.size || crc32(bytes) !== entry.crc) throw new Error(`ZIP CRC 검사에 실패했습니다: ${entry.name}`);
  return bytes;
}
function imagesUnderJsonRoot(entries: Map<string, ZipEntry>, basePath: string): Map<string, ZipEntry> {
  const images = new Map<string, ZipEntry>();
  for (const [path, entry] of entries) {
    if (!path.startsWith(basePath) || !/\.(?:jpe?g|png)$/iu.test(path)) continue;
    const relative = normalizeZipPath(path.slice(basePath.length));
    if (images.has(relative)) throw new Error(`ZIP 이미지 경로가 모호합니다: ${relative}`);
    images.set(relative, entry);
  }
  return images;
}
/** Resolves the exact relative path only; never guesses from a basename or another folder. */
export function resolveBookImageEntry(archive: BookArchive, relativePath: string): ZipEntry {
  const relative = normalizeZipPath(relativePath);
  if (!/\.(?:jpe?g|png)$/iu.test(relative)) throw new Error(`지원하지 않는 이미지 경로입니다: ${relativePath}`);
  const entry = archive.imageEntries.get(relative);
  if (!entry || !entry.name.startsWith(archive.basePath)) throw new Error(`이미지가 없습니다: ${relativePath}`);
  return entry;
}
export async function inspectBookArchive(file: File, onProgress?: (message: string) => void): Promise<BookArchive> {
  onProgress?.('ZIP 목록 확인 중 · 저장하지 않습니다');
  const entries = await readZipDirectory(file);
  const jsonPaths = [...entries.keys()].filter((path) => path.split('/').at(-1) === 'questions.json');
  if (jsonPaths.length !== 1) throw new Error(jsonPaths.length ? 'questions.json이 여러 개여서 데이터 원본을 정할 수 없습니다.' : 'ZIP에서 questions.json을 찾지 못했습니다.');
  const jsonPath = jsonPaths[0];
  const basePath = jsonPath.includes('/') ? jsonPath.slice(0, jsonPath.lastIndexOf('/') + 1) : '';
  onProgress?.('questions.json 읽기 전용 검사 중');
  const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readZipEntry(file, entries.get(jsonPath)!)));
  const imageEntries = imagesUnderJsonRoot(entries, basePath);
  const report = inspectBookData(parsed, imageEntries.keys());
  onProgress?.('원본 파일 SHA-256 확인 중');
  const sha256 = await sha256Hex(await file.arrayBuffer());
  return { file, entries, jsonPath, basePath, imageEntries, parsed, report, sha256 };
}
export async function readBookImage(archive: BookArchive, relativePath: string): Promise<Blob> {
  const entry = resolveBookImageEntry(archive, relativePath);
  const bytes = await readZipEntry(archive.file, entry);
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (!jpeg && !png) throw new Error(`지원하지 않는 이미지입니다: ${relativePath}`);
  return new Blob([bytes], { type: jpeg ? 'image/jpeg' : 'image/png' });
}
