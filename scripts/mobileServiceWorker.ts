import { createHash } from 'node:crypto';

/** Only application assets. Textbook ZIPs, device packages and API responses are never cached. */
export function mobilePrecache(paths: string[], base = '/'): string[] {
  const root = base.endsWith('/') ? base : `${base}/`;
  const scripts = paths.filter((path) => /\.(?:js|mjs|css|svg|png|webmanifest)$/.test(path)
    && !path.startsWith('ocr/') && !path.startsWith('pdfjs/')
    && !/\/(?:pdf\.worker|worker\.min)/.test(`/${path}`));
  return [...new Set(['', 'index.html', 'manifest.webmanifest', 'favicon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png', ...scripts].map((path) => `${root}${path}`))].sort();
}

export function createMobileServiceWorker(paths: string[], base = '/'): string {
  const precache = mobilePrecache(paths, base);
  const indexPath = JSON.stringify(`${base.endsWith('/') ? base : `${base}/`}index.html`);
  const revision = createHash('sha256').update(`mobile-v1:${precache.join('\n')}`).digest('hex').slice(0, 20);
  return `const CACHE_PREFIX = 'safety-cbt-mobile-';
const CACHE_NAME = CACHE_PREFIX + ${JSON.stringify(revision)};
const PRECACHE_URLS = ${JSON.stringify(precache)};
const ASSETS = new Set(PRECACHE_URLS);
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
});
// Updates wait for existing app windows to close. Never reload an active study session.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => {
      if (response.ok && !response.redirected) return response;
      return caches.open(CACHE_NAME).then(cache => cache.match(${indexPath})).then(cached => cached || response);
    }).catch(() => caches.open(CACHE_NAME).then(cache => cache.match(${indexPath})).then(cached => cached || new Response('앱을 인터넷에 연결해 한 번 열어 주세요.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}}))));
    return;
  }
  if (!ASSETS.has(url.pathname)) return;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    const cached = await cache.match(url.pathname);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok && !response.redirected) await cache.put(url.pathname, response.clone());
    return response;
  }));
});
`;
}
