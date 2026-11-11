import { describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import { createMobileServiceWorker, mobilePrecache } from './mobileServiceWorker';

function runtime(offline = false) {
  const handlers: Record<string, (event: { waitUntil?: (p: Promise<unknown>) => void; respondWith?: (p: Promise<Response>) => void; request?: unknown }) => void> = {};
  const content = new Map<string, Response>();
  const cache = { addAll: vi.fn(async (paths: string[]) => { for (const path of paths) content.set(path, new Response(path === '/index.html' ? 'synthetic-app-shell' : path)); }), match: vi.fn(async (path: string) => content.get(path)?.clone()), put: vi.fn(async (path: string, response: Response) => { content.set(path, response); }) };
  const caches = { open: vi.fn(async () => cache), keys: vi.fn(async () => ['safety-cbt-mobile-old','unrelated-user-cache','safety-cbt-legacy']), delete: vi.fn(async () => true) };
  const fetch = vi.fn(async () => { if (offline) throw new Error('offline'); return new Response('online'); });
  const self = { location: { origin: 'https://fixture.example' }, clients: { claim: vi.fn(async () => {}) }, skipWaiting: vi.fn(), addEventListener: (name: string, fn: typeof handlers[string]) => { handlers[name] = fn; } };
  runInNewContext(createMobileServiceWorker(['assets/app-abc.js','assets/app-abc.css']), { self,caches,fetch,URL,Set,Response });
  const lifecycle = async (name: string) => { let pending: Promise<unknown> | undefined; handlers[name]({waitUntil: p => {pending=p;}}); await pending; };
  const request = async (path: string, mode = 'cors', method = 'GET') => { let pending: Promise<Response> | undefined; handlers.fetch({request:{url:path.startsWith('https:')?path:`https://fixture.example${path}`,mode,method},respondWith:p=>{pending=p;}}); return pending; };
  return { content,cache,caches,self,fetch,lifecycle,request };
}

describe('mobile offline app shell', () => {
  it('precaches CBT modules and icons but excludes OCR and raw worker payloads', () => {
    const paths = mobilePrecache(['assets/app.js','assets/BookImporter.js','assets/pdf.worker.min.mjs','ocr/core/engine.js','ocr/lang/kor.gz','pdfjs/wasm/decoder.js']);
    expect(paths).toContain('/assets/BookImporter.js'); expect(paths).toContain('/icons/apple-touch-icon.png');
    expect(paths.some(path => /ocr|pdfjs|pdf.worker/.test(path))).toBe(false);
  });
  it('opens cached app HTML and assets when the network is unavailable', async () => {
    const r = runtime(true); await r.lifecycle('install');
    expect(await (await r.request('/','navigate'))!.text()).toBe('synthetic-app-shell');
    expect(await (await r.request('/assets/app-abc.css'))!.text()).toBe('/assets/app-abc.css');
  });
  it('never intercepts source ZIPs, local Mac APIs, external sites or uploads', async () => {
    const r = runtime(); await r.lifecycle('install');
    for (const path of ['/__local-book/archive','/private-book.zip','/device-package.zip','https://other.example/a.js']) expect(await r.request(path)).toBeUndefined();
    expect(await r.request('/assets/app-abc.js','cors','POST')).toBeUndefined();
  });
  it('waits for old windows to close and preserves unrelated caches during activation', async () => {
    const r = runtime(); await r.lifecycle('install'); expect(r.self.skipWaiting).not.toHaveBeenCalled();
    await r.lifecycle('activate'); expect(r.caches.delete.mock.calls).toEqual([['safety-cbt-mobile-old']]);
    expect(r.self.clients.claim).toHaveBeenCalledOnce();
  });
});
