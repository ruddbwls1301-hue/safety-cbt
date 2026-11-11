import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isLoopbackAddress, isPrivateIpv4, lanRequestAllowed, localBookArchive, localBookRequestAllowed, validLocalBookArchivePath } from './localBookArchive';

describe('local book archive access', () => {
  it('accepts the local app request and rejects remote sockets, hostile hosts, and other origins', () => {
    const local = { host: 'localhost:4183', remoteAddress: '::ffff:127.0.0.1', origin: 'http://localhost:4183', fetchSite: 'same-origin' };
    expect(localBookRequestAllowed(local)).toBe(true);
    expect(localBookRequestAllowed({ ...local, remoteAddress: '192.168.1.2' })).toBe(false);
    expect(localBookRequestAllowed({ ...local, host: 'example.com:4183' })).toBe(false);
    expect(localBookRequestAllowed({ ...local, host: 'localhost.evil.example' })).toBe(false);
    expect(localBookRequestAllowed({ ...local, origin: 'http://localhost:4180' })).toBe(false);
    expect(localBookRequestAllowed({ ...local, origin: 'null' })).toBe(false);
    expect(localBookRequestAllowed({ ...local, fetchSite: 'cross-site' })).toBe(false);
    expect(localBookRequestAllowed({ ...local, fetchSite: 'same-site' })).toBe(false);
    expect(localBookRequestAllowed({ ...local, referer: 'https://example.com/' })).toBe(false);
    expect(localBookRequestAllowed({ ...local, host: 'localhost:65536' })).toBe(false);
    expect(localBookRequestAllowed({ host: '[::1]:4183', remoteAddress: '::1', origin: 'http://[::1]:4183', fetchSite: 'same-origin' })).toBe(true);
  });

  it('requires an explicit absolute ZIP path and recognizes only loopback client addresses', () => {
    expect(validLocalBookArchivePath(undefined)).toBe(false);
    expect(validLocalBookArchivePath('relative.zip')).toBe(false);
    expect(validLocalBookArchivePath('/private/validation.jpg')).toBe(false);
    expect(validLocalBookArchivePath('/private/검증 자료.ZIP')).toBe(true);
    expect(isLoopbackAddress('127.0.0.2')).toBe(true);
    expect(isLoopbackAddress('127.999.0.1')).toBe(false);
    expect(isLoopbackAddress('::ffff:192.168.1.2')).toBe(false);
    expect(isLoopbackAddress(undefined)).toBe(false);
    const plugin = localBookArchive('/private/validation.zip');
    expect(plugin.apply).toBe('serve');
    expect(plugin.generateBundle).toBeUndefined();
    // Phase 2B: the local production preview must enforce the same gate as the dev server.
    expect(typeof plugin.configurePreviewServer).toBe('function');
  });

  it('denies unset files, path parameters, and non-GET methods without reading an archive or exposing its path', async () => {
    type Handler = (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;
    let handler: Handler | undefined;
    const plugin = localBookArchive('');
    const hook = plugin.configureServer as (server: unknown) => unknown;
    hook({ middlewares: { use: (middleware: Handler) => { handler = middleware; } } });
    for (const [url, method, expected] of [
      ['/__local-book/metadata', 'GET', 404],
      ['/__local-book/archive?path=/private/secret.zip', 'GET', 404],
      ['/__local-book/archive', 'POST', 405],
    ] as const) {
      const headers = new Map<string, string>([['Access-Control-Allow-Origin', '*']]);
      let body = '';
      const response = {
        statusCode: 200, headersSent: false, destroyed: false,
        setHeader: (name: string, value: string) => headers.set(name, value),
        removeHeader: (name: string) => headers.delete(name),
        end: (value: string) => { body = value; },
      };
      await handler!({ url, method, headers: { host: 'localhost:4183', 'sec-fetch-site': 'same-origin' }, socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage, response as unknown as ServerResponse, () => { throw new Error('Unexpected fallback'); });
      expect(response.statusCode).toBe(expected);
      expect(headers.get('Cache-Control')).toBe('no-store');
      expect(headers.has('Access-Control-Allow-Origin')).toBe(false);
      expect(body).not.toContain('/private/secret.zip');
    }
  });
});

describe('paired private LAN access', () => {
  const interfaces = [{ address: '192.168.42.10', netmask: '255.255.255.0' }];
  const phone = { host: '192.168.42.10:4183', remoteAddress: '192.168.42.20', origin: 'http://192.168.42.10:4183', fetchSite: 'same-origin' };
  it('changes a resolved loopback listener only when authenticated LAN mode is explicitly enabled', () => {
    const apply = (enabled: boolean) => {
      const plugin = localBookArchive('', { lanAccess: enabled, interfaces });
      const config = { server: { host: '127.0.0.1' } };
      (plugin.configResolved as (config: unknown) => void)(config);
      return config.server.host;
    };
    expect(apply(true)).toBe('0.0.0.0');
    expect(apply(false)).toBe('127.0.0.1');
  });
  it('widens the preview listener only together with the gate in authenticated LAN mode', () => {
    const apply = (enabled: boolean) => {
      const plugin = localBookArchive('', { lanAccess: enabled, interfaces });
      const config = { server: { host: '127.0.0.1' }, preview: { host: '127.0.0.1' } };
      (plugin.configResolved as (config: unknown) => void)(config);
      return config.preview.host;
    };
    expect(apply(true)).toBe('0.0.0.0');
    expect(apply(false)).toBe('127.0.0.1');
  });
  it('gates every production preview file (HTML, JS, CSS, wasm, OCR data, sw.js) and the ZIP API until pairing', async () => {
    type Handler = (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;
    let handler: Handler | undefined;
    let upgrade: ((request: IncomingMessage, socket: { destroy: () => void }) => void) | undefined;
    const pairingCode = 'F6E5D4C3B2A1';
    const plugin = localBookArchive('', { lanAccess: true, interfaces, pairingCode });
    (plugin.configurePreviewServer as (server: unknown) => unknown)({ httpServer: { on: (_event: string, listener: typeof upgrade) => { upgrade = listener; } }, middlewares: { use: (middleware: Handler) => { handler = middleware; } } });
    expect(handler).toBeDefined();
    const send = async (url: string, method = 'GET', extraHeaders: Record<string, string> = {}, body = '', remoteAddress = phone.remoteAddress, host = phone.host) => {
      const headers = new Map<string, string>();
      let responseBody = '';
      let nextCalled = false;
      const response = { statusCode: 200, headersSent: false, destroyed: false,
        setHeader: (name: string, value: string) => headers.set(name, value), removeHeader: (name: string) => headers.delete(name),
        end: (value?: string) => { responseBody = value ?? ''; },
      };
      const request = { url, method, headers: { host, origin: `http://${host}`, 'sec-fetch-site': 'same-origin', ...extraHeaders }, socket: { remoteAddress }, async *[Symbol.asyncIterator]() { yield Buffer.from(body); } };
      await handler!(request as unknown as IncomingMessage, response as unknown as ServerResponse, () => { nextCalled = true; });
      return { status: response.statusCode, body: responseBody, headers, nextCalled };
    };
    const files = ['/index.html', '/assets/index-abc123.js', '/assets/index-abc123.css', '/assets/BookImporter-abc.js', '/pdfjs/wasm/openjpeg.wasm', '/ocr/core/tesseract-core-lstm.wasm', '/ocr/lang/kor.traineddata.gz', '/sw.js', '/manifest.webmanifest', '/favicon.svg', '/__local-book/archive', '/__local-book/metadata', '/__local-book/network'];
    for (const path of files) {
      const denied = await send(path);
      expect(denied.status, path).toBe(403);
      expect(denied.nextCalled, path).toBe(false);
      expect(denied.body).not.toContain(pairingCode);
    }
    // A foreign subnet or a public Host header is denied outright, even for the landing page.
    expect((await send('/', 'GET', { accept: 'text/html' }, '', '10.9.8.7')).status).toBe(403);
    expect((await send('/assets/index-abc123.js', 'GET', {}, '', '192.168.42.20', 'example.test:4190')).status).toBe(403);
    const screen = await send('/', 'GET', { accept: 'text/html' });
    expect(screen.body).toContain('CBT 기기 연결');
    expect(screen.body).not.toContain(pairingCode);
    expect(screen.nextCalled).toBe(false);
    expect((await send('/__local-book/pair', 'POST', { 'content-type': 'application/x-www-form-urlencoded' }, 'code=000000000000')).status).toBe(403);
    const paired = await send('/__local-book/pair', 'POST', { 'content-type': 'application/x-www-form-urlencoded' }, `code=${pairingCode}`);
    expect(paired.status).toBe(303);
    const cookie = paired.headers.get('Set-Cookie')!.split(';')[0];
    for (const path of files.filter((path) => !path.startsWith('/__local-book/'))) {
      const allowed = await send(path, 'GET', { cookie });
      expect(allowed.nextCalled, path).toBe(true);
    }
    expect((await send('/assets/index-abc123.js', 'GET', { cookie }, '', '192.168.42.21')).status).toBe(403);
    expect(JSON.parse((await send('/__local-book/network', 'GET', { cookie })).body)).toEqual({ enabled: true, urls: [], pairingCode: '', paired: true });
    const desktop = await send('/__local-book/network', 'GET', {}, '', '127.0.0.1', 'localhost:4190');
    expect(JSON.parse(desktop.body)).toMatchObject({ enabled: true, urls: ['http://192.168.42.10:4190/'], pairingCode });
    expect((await send('/assets/index-abc123.js', 'GET', {}, '', '127.0.0.1', 'localhost:4190')).nextCalled).toBe(true);
    const deniedSocket = { destroy: vi.fn() };
    upgrade!({ headers: { host: phone.host, origin: phone.origin }, socket: { remoteAddress: phone.remoteAddress } } as unknown as IncomingMessage, deniedSocket);
    expect(deniedSocket.destroy).toHaveBeenCalled();
  });
  it('limits LAN hosts to the computer private address and peers on its subnet', () => {
    expect(isPrivateIpv4('172.26.20.216')).toBe(true);
    expect(isPrivateIpv4('172.32.20.216')).toBe(false);
    expect(isPrivateIpv4('8.8.8.8')).toBe(false);
    expect(lanRequestAllowed(phone, interfaces)).toBe(true);
    expect(lanRequestAllowed({ ...phone, remoteAddress: '::ffff:192.168.42.20' }, interfaces)).toBe(true);
    expect(lanRequestAllowed({ ...phone, remoteAddress: '192.168.43.20' }, interfaces)).toBe(false);
    expect(lanRequestAllowed({ ...phone, host: '192.168.42.99:4183' }, interfaces)).toBe(false);
    expect(lanRequestAllowed({ ...phone, host: 'example.test:4183' }, interfaces)).toBe(false);
    expect(lanRequestAllowed({ ...phone, origin: 'https://example.test' }, interfaces)).toBe(false);
    expect(lanRequestAllowed({ ...phone, origin: 'null' }, interfaces)).toBe(false);
    expect(lanRequestAllowed({ ...phone, fetchSite: 'cross-site' }, interfaces)).toBe(false);
  });
  it('gates every Vite path and ZIP until pairing, never exposes the PC code to a phone, and binds the session to its peer', async () => {
    type Handler = (request: IncomingMessage, response: ServerResponse, next: () => void) => Promise<void>;
    let handler: Handler | undefined;
    const pairingCode = 'A1B2C3D4E5F6';
    let upgrade: ((request: IncomingMessage, socket: { destroy: () => void }) => void) | undefined;
    const plugin = localBookArchive('', { lanAccess: true, interfaces, pairingCode });
    (plugin.configureServer as (server: unknown) => unknown)({ httpServer: { on: (_event: string, listener: typeof upgrade) => { upgrade = listener; } }, middlewares: { use: (middleware: Handler) => { handler = middleware; } } });
    const send = async (url: string, method = 'GET', extraHeaders: Record<string, string> = {}, body = '', remoteAddress = phone.remoteAddress) => {
      const headers = new Map<string, string>();
      let responseBody = '';
      let nextCalled = false;
      const response = { statusCode: 200, headersSent: false, destroyed: false,
        setHeader: (name: string, value: string) => headers.set(name, value), removeHeader: (name: string) => headers.delete(name),
        end: (value?: string) => { responseBody = value ?? ''; },
      };
      const request = { url, method, headers: { host: phone.host, origin: phone.origin, 'sec-fetch-site': 'same-origin', ...extraHeaders }, socket: { remoteAddress }, async *[Symbol.asyncIterator]() { yield Buffer.from(body); } };
      await handler!(request as unknown as IncomingMessage, response as unknown as ServerResponse, () => { nextCalled = true; });
      return { status: response.statusCode, body: responseBody, headers, nextCalled };
    };
    for (const path of ['/__local-book/archive', '/__local-book/metadata', '/__local-book/network', '/src/App.tsx', '/@fs/private/secret']) {
      const denied = await send(path);
      expect(denied.status).toBe(403);
      expect(denied.nextCalled).toBe(false);
      expect(denied.body).not.toContain(pairingCode);
    }
    const screen = await send('/', 'GET', { accept: 'text/html' });
    expect(screen.body).toContain('CBT 기기 연결');
    expect(screen.body).not.toContain(pairingCode);
    expect(screen.headers.get('Referrer-Policy')).toBe('same-origin');
    const crossSiteNavigation = { origin: 'http://localhost:4183', referer: 'http://localhost:4183/', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' };
    const linkedScreen = await send('/', 'GET', crossSiteNavigation);
    expect(linkedScreen.body).toContain('CBT 기기 연결');
    expect(linkedScreen.nextCalled).toBe(false);
    expect(linkedScreen.headers.get('Referrer-Policy')).toBe('same-origin');
    expect((await send('/src/App.tsx', 'GET', crossSiteNavigation)).status).toBe(403);
    expect((await send('/__local-book/archive', 'GET', crossSiteNavigation)).status).toBe(403);
    expect((await send('/__local-book/pair', 'POST', { ...crossSiteNavigation, 'content-type': 'application/x-www-form-urlencoded' }, `code=${pairingCode}`)).status).toBe(403);
    const nullOriginPost = await send('/__local-book/pair', 'POST', { origin: 'null', 'content-type': 'application/x-www-form-urlencoded' }, `code=${pairingCode}`);
    expect(nullOriginPost.status).toBe(403);
    expect(nullOriginPost.headers.has('Set-Cookie')).toBe(false);
    expect((await send('/__local-book/pair', 'POST', { 'content-type': 'application/x-www-form-urlencoded' }, 'code=한글한글한글한글한글한글')).status).toBe(403);
    const paired = await send('/__local-book/pair', 'POST', { 'content-type': 'application/x-www-form-urlencoded' }, `code=${pairingCode}`);
    expect(paired.status).toBe(303);
    expect(paired.headers.get('Set-Cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(paired.headers.get('Location')).toBe('/');
    const cookie = paired.headers.get('Set-Cookie')!.split(';')[0];
    const pairedLinkedScreen = await send('/', 'GET', { ...crossSiteNavigation, cookie });
    expect(pairedLinkedScreen.body).toContain('CBT 기기 연결');
    expect(pairedLinkedScreen.nextCalled).toBe(false);
    expect((await send('/src/App.tsx', 'GET', { cookie })).nextCalled).toBe(true);
    const info = await send('/__local-book/network', 'GET', { cookie });
    expect(JSON.parse(info.body)).toEqual({ enabled: true, urls: [], pairingCode: '', paired: true });
    expect((await send('/src/App.tsx', 'GET', { cookie }, '', '192.168.42.21')).status).toBe(403);
    expect((await send('/src/App.tsx', 'GET', { cookie, origin: 'https://example.test', 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    const websocketRequest = (cookieHeader?: string) => ({ headers: { host: phone.host, origin: phone.origin, ...(cookieHeader ? { cookie: cookieHeader } : {}) }, socket: { remoteAddress: phone.remoteAddress } }) as unknown as IncomingMessage;
    const deniedSocket = { destroy: vi.fn() };
    upgrade!(websocketRequest(), deniedSocket);
    expect(deniedSocket.destroy).toHaveBeenCalled();
    const pairedSocket = { destroy: vi.fn() };
    upgrade!(websocketRequest(cookie), pairedSocket);
    expect(pairedSocket.destroy).not.toHaveBeenCalled();
    const desktop = await send('/__local-book/network', 'GET', { host: 'localhost:4183', origin: 'http://localhost:4183' }, '', '127.0.0.1');
    expect(JSON.parse(desktop.body)).toMatchObject({ enabled: true, urls: ['http://192.168.42.10:4183/'], pairingCode });
    for (let index = 0; index < 10; index++) expect((await send('/__local-book/pair', 'POST', { 'content-type': 'application/x-www-form-urlencoded' }, 'code=wrong')).status).toBe(403);
    expect((await send('/__local-book/pair', 'POST', { 'content-type': 'application/x-www-form-urlencoded' }, `code=${pairingCode}`)).status).toBe(429);
  });
});
