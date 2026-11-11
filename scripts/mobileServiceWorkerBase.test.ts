import { describe, expect, it } from 'vitest';
import { createMobileServiceWorker, mobilePrecache } from './mobileServiceWorker';

describe('service worker deploy base', () => {
  it('precaches under the same base the app is served from', () => {
    expect(mobilePrecache(['assets/app.js'])).toContain('/assets/app.js');
    expect(mobilePrecache(['assets/app.js'])).toContain('/index.html');
    const scoped = mobilePrecache(['assets/app.js', 'ocr/core/x.js'], '/CARE-PLUS/cbt/');
    expect(scoped).toContain('/CARE-PLUS/cbt/');
    expect(scoped).toContain('/CARE-PLUS/cbt/assets/app.js');
    expect(scoped.every((path) => path.startsWith('/CARE-PLUS/cbt/'))).toBe(true);
    expect(scoped.some((path) => path.includes('ocr/'))).toBe(false);
    expect(createMobileServiceWorker(['assets/app.js'], '/CARE-PLUS/cbt/')).toContain('cache.match("/CARE-PLUS/cbt/index.html")');
    expect(createMobileServiceWorker(['assets/app.js'])).toContain('cache.match("/index.html")');
  });
});
