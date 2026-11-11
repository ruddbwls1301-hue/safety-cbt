/** UUID generation also works on a private HTTP origin, where randomUUID may be absent. */
export function randomBrowserId(): string {
  const cryptography = globalThis.crypto;
  if (typeof cryptography?.randomUUID === 'function') return cryptography.randomUUID();
  if (typeof cryptography?.getRandomValues !== 'function') throw new Error('이 브라우저는 안전한 문항 ID 생성을 지원하지 않습니다.');
  const bytes = cryptography.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// SHA-256 constants and word operations: NIST FIPS 180-4, sections 4.2.2 and 6.2.
// https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.180-4.pdf
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotate = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));

/** Small local fallback; yields between 1MB batches so mobile progress remains responsive. */
export async function sha256HexFallback(bytes: Uint8Array): Promise<string> {
  const state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const words = new Uint32Array(64);
  const compress = (block: Uint8Array, offset: number) => {
    for (let index = 0; index < 16; index++) {
      const start = offset + index * 4;
      words[index] = (block[start] << 24) | (block[start + 1] << 16) | (block[start + 2] << 8) | block[start + 3];
    }
    for (let index = 16; index < 64; index++) {
      const left = words[index - 15];
      const right = words[index - 2];
      words[index] = words[index - 16] + (rotate(left, 7) ^ rotate(left, 18) ^ (left >>> 3)) + words[index - 7] + (rotate(right, 17) ^ rotate(right, 19) ^ (right >>> 10));
    }
    let [a, b, c, d, e, f, g, h] = state;
    for (let index = 0; index < 64; index++) {
      const first = (h + (rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)) + ((e & f) ^ (~e & g)) + K[index] + words[index]) >>> 0;
      const second = ((rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + first) >>> 0; d = c; c = b; b = a; a = (first + second) >>> 0;
    }
    for (const [index, value] of [a, b, c, d, e, f, g, h].entries()) state[index] = (state[index] + value) >>> 0;
  };
  const fullBytes = bytes.length - bytes.length % 64;
  for (let offset = 0; offset < fullBytes; offset += 64) {
    compress(bytes, offset);
    if (offset > 0 && offset % 1048576 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  const remainder = bytes.subarray(fullBytes);
  const final = new Uint8Array(remainder.length < 56 ? 64 : 128);
  final.set(remainder);
  final[remainder.length] = 0x80;
  const end = new DataView(final.buffer);
  end.setUint32(final.length - 8, Math.floor(bytes.length / 0x20000000), false);
  end.setUint32(final.length - 4, (bytes.length * 8) >>> 0, false);
  compress(final, 0);
  if (final.length === 128) compress(final, 64);
  return [...state].map((value) => value.toString(16).padStart(8, '0')).join('');
}

export async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (globalThis.crypto?.subtle) {
    const result = await globalThis.crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(result)].map((value) => value.toString(16).padStart(2, '0')).join('');
  }
  return sha256HexFallback(bytes);
}
