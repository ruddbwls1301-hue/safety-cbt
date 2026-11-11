import { describe, expect, it } from 'vitest';
import { withBase } from './basePath';

describe('deploy base path', () => {
  it('keeps root deployments unchanged and prefixes sub-path deployments', () => {
    expect(withBase('/', 'ocr/lang')).toBe('/ocr/lang');
    expect(withBase('/', '/sw.js')).toBe('/sw.js');
    expect(withBase('/CARE-PLUS/cbt/', 'pdfjs/wasm/')).toBe('/CARE-PLUS/cbt/pdfjs/wasm/');
    expect(withBase('/CARE-PLUS/cbt', 'sw.js')).toBe('/CARE-PLUS/cbt/sw.js');
  });
});
