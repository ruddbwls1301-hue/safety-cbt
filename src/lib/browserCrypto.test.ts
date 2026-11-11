import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomBrowserId, sha256Hex, sha256HexFallback } from './browserCrypto';

const encode = (value: string) => new TextEncoder().encode(value);
const native = globalThis.crypto;
afterEach(() => vi.unstubAllGlobals());
describe('private HTTP browser crypto compatibility', () => {
  it('matches published SHA-256 vectors and native hashes at block/padding boundaries', async () => {
    expect(await sha256HexFallback(encode(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256HexFallback(encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    for (const size of [55, 56, 63, 64, 65, 127, 128, 129, 1048643]) {
      const bytes = Uint8Array.from({ length: size }, (_, index) => index & 255);
      const expected = [...new Uint8Array(await native.subtle.digest('SHA-256', bytes))].map((value) => value.toString(16).padStart(2, '0')).join('');
      expect(await sha256HexFallback(bytes)).toBe(expected);
    }
  });
  it('uses the hash fallback and secure v4 UUID generation when HTTP omits subtle/randomUUID', async () => {
    vi.stubGlobal('crypto', { getRandomValues: native.getRandomValues.bind(native) });
    expect(await sha256Hex(encode('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    const ids = Array.from({ length: 100 }, () => randomBrowserId());
    expect(ids.every((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    vi.stubGlobal('crypto', {});
    expect(() => randomBrowserId()).toThrow('안전한 문항 ID');
  });
});
