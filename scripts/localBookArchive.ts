import type { Plugin } from 'vite';
import { open } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { isIP } from 'node:net';
import { pipeline } from 'node:stream/promises';
import { networkInterfaces } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';

export const MAX_LOCAL_BOOK_ARCHIVE_BYTES = 256 * 1024 * 1024;

export type LocalBookRequestContext = {
  host?: string;
  remoteAddress?: string;
  origin?: string;
  fetchSite?: string;
  referer?: string;
  secure?: boolean;
};
export type LanInterface = { address: string; netmask: string };
export type LocalBookArchiveOptions = { lanAccess?: boolean; interfaces?: LanInterface[]; pairingCode?: string };
const COOKIE_NAME = 'cbt_local_pair';
const SESSION_MS = 12 * 60 * 60 * 1000;
function ipv4Value(address: string): number {
  return address.split('.').reduce((value, part) => (value * 256 + Number(part)) >>> 0, 0);
}
export function isPrivateIpv4(address: string): boolean {
  if (isIP(address) !== 4) return false;
  const parts = address.split('.').map(Number);
  return parts[0] === 10 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168);
}
export function localLanInterfaces(): LanInterface[] {
  return Object.values(networkInterfaces()).flatMap((entries) => entries ?? []).filter((entry) => !entry.internal && entry.family === 'IPv4' && isPrivateIpv4(entry.address)).map(({ address, netmask }) => ({ address, netmask }));
}
function sameAppOrigin(context: LocalBookRequestContext): boolean {
  let expectedOrigin: string;
  try { expectedOrigin = new URL(`${context.secure ? 'https' : 'http'}://${context.host}`).origin; }
  catch { return false; }
  if (context.origin !== undefined && context.origin !== expectedOrigin) return false;
  if (context.fetchSite !== undefined && !['same-origin', 'none'].includes(context.fetchSite)) return false;
  if (context.referer !== undefined) {
    try { if (new URL(context.referer).origin !== expectedOrigin) return false; }
    catch { return false; }
  }
  return true;
}
/** LAN is limited to this computer's current private addresses and the same IPv4 subnet. */
export function lanRequestAllowed(context: LocalBookRequestContext, interfaces: LanInterface[]): boolean {
  const match = /^(\d+\.\d+\.\d+\.\d+)(?::([0-9]{1,5}))?$/u.exec(context.host ?? '');
  const remote = context.remoteAddress?.replace(/^::ffff:/iu, '') ?? '';
  if (!match || !isPrivateIpv4(match[1]) || !isPrivateIpv4(remote) || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return false;
  return sameAppOrigin(context) && interfaces.some((entry) => entry.address === match[1] && isIP(entry.netmask) === 4 && ((ipv4Value(remote) & ipv4Value(entry.netmask)) >>> 0) === ((ipv4Value(entry.address) & ipv4Value(entry.netmask)) >>> 0));
}

export function isLoopbackAddress(address?: string): boolean {
  if (!address) return false;
  if (address === '::1' || address === '0:0:0:0:0:0:0:1') return true;
  const ipv4 = address.replace(/^::ffff:/iu, '');
  return isIP(ipv4) === 4 && ipv4.split('.')[0] === '127';
}

/** Keep this explicitly selected file confined to requests from the local app origin. */
export function localBookRequestAllowed(context: LocalBookRequestContext): boolean {
  const match = /^(localhost|127\.0\.0\.1|\[::1\])(?::([0-9]{1,5}))?$/iu.exec(context.host ?? '');
  if (!match || !isLoopbackAddress(context.remoteAddress)) return false;
  if (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535)) return false;
  return sameAppOrigin(context);
}

export function validLocalBookArchivePath(path?: string): path is string {
  return Boolean(path && isAbsolute(path) && extname(path).toLowerCase() === '.zip');
}

/** Dev server and local `vite preview` only; the archive stays outside the repository and is never emitted into a build. */
export function localBookArchive(path = process.env.CBT_LOCAL_BOOK_ZIP, options: LocalBookArchiveOptions = {}): Plugin {
  const lanAccess = options.lanAccess ?? process.env.CBT_LAN_ACCESS === '1';
  const pairingCode = options.pairingCode ?? randomBytes(6).toString('hex').toUpperCase();
  const sessions = new Map<string, { address: string; expires: number }>();
  const attempts = new Map<string, { started: number; failures: number }>();
  const plugin: Plugin = {
    name: 'local-book-archive',
    apply: 'serve',
    configResolved(config) {
      // Vite config edits can restart a running loopback server without touching its PID.
      // Expose the listener only together with this plugin's mandatory device gate.
      if (lanAccess) {
        config.server.host = '0.0.0.0';
        if (config.preview) config.preview.host = '0.0.0.0';
      }
    },
    configureServer(server) {
      installGate(server);
    },
    // `vite preview` serves the production build; apply the identical gate before any static file.
    configurePreviewServer(server) {
      installGate(server);
    },
  };
  return plugin;
  function installGate(server: { httpServer?: { on(event: 'upgrade', listener: (request: IncomingMessage, socket: Duplex) => void): unknown } | null; middlewares: { use(handler: (request: IncomingMessage, response: ServerResponse, next: () => void) => void | Promise<void>): unknown } }) {
      // Vite's HMR upgrade bypasses ordinary HTTP middleware; enforce the same device gate.
      server.httpServer?.on('upgrade', (request, socket) => {
        const single = (value: string | string[] | undefined) => typeof value === 'string' ? value : value === undefined ? undefined : '';
        const context: LocalBookRequestContext = {
          host: single(request.headers.host), remoteAddress: request.socket.remoteAddress,
          origin: single(request.headers.origin), fetchSite: single(request.headers['sec-fetch-site']), referer: single(request.headers.referer),
          secure: Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted),
        };
        if (localBookRequestAllowed(context)) return;
        const cookie = /(?:^|;\s*)cbt_local_pair=([A-Za-z0-9_-]+)/u.exec(single(request.headers.cookie) ?? '')?.[1];
        const session = cookie ? sessions.get(cookie) : undefined;
        if (lanAccess && lanRequestAllowed(context, options.interfaces ?? localLanInterfaces()) && session && session.expires > Date.now() && session.address === context.remoteAddress) return;
        socket.destroy();
      });
      server.middlewares.use(async (request, response, next) => {
        const route = (request.url ?? '').split('?')[0];
        const fail = (status: number, message: string) => {
          response.statusCode = status;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({ error: message }));
        };
        const header = (name: string) => {
          const value = request.headers[name];
          return typeof value === 'string' ? value : value === undefined ? undefined : '';
        };
        const context: LocalBookRequestContext = {
          host: header('host'), remoteAddress: request.socket.remoteAddress,
          origin: header('origin'), fetchSite: header('sec-fetch-site'), referer: header('referer'),
          secure: Boolean((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted),
        };
        const local = localBookRequestAllowed(context);
        const interfaces = options.interfaces ?? localLanInterfaces();
        const lan = lanAccess && lanRequestAllowed(context, interfaces);
        // An address opened from the PC/chat may carry a cross-site navigation referrer.
        // Relax only the empty landing portal, never the app, ZIP, API, or pairing POST.
        const landing = !lan && lanAccess && request.method === 'GET' && route === '/'
          && header('sec-fetch-mode') === 'navigate' && header('sec-fetch-dest') === 'document'
          && lanRequestAllowed({ ...context, origin: undefined, referer: undefined, fetchSite: 'none' }, interfaces);
        if (!local && !lan && !landing) return fail(403, '이 Mac 또는 같은 Wi-Fi에서 연결한 기기만 사용할 수 있습니다.');
        const cookie = /(?:^|;\s*)cbt_local_pair=([A-Za-z0-9_-]+)/u.exec(header('cookie') ?? '')?.[1];
        const session = cookie ? sessions.get(cookie) : undefined;
        const paired = Boolean(session && session.expires > Date.now() && session.address === context.remoteAddress);
        if ((lan || landing) && (!paired || landing)) {
          response.setHeader('Cache-Control', 'no-store');
          // Preserve the same-origin form POST Origin; no-referrer serializes it as null.
          response.setHeader('Referrer-Policy', 'same-origin');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          if (route === '/__local-book/pair' && request.method === 'POST' && !request.url?.includes('?')) {
            const key = context.remoteAddress!;
            const previous = attempts.get(key);
            const rate = previous && Date.now() - previous.started < 15 * 60 * 1000 ? previous : { started: Date.now(), failures: 0 };
            attempts.set(key, rate);
            if (rate.failures >= 10) return fail(429, '연결 코드 확인 횟수를 초과했습니다. 잠시 후 다시 시도해 주세요.');
            if (!header('content-type')?.startsWith('application/x-www-form-urlencoded')) return fail(415, '연결 코드 입력 화면에서 다시 시도해 주세요.');
            let body = '';
            for await (const part of request) {
              body += part.toString();
              if (body.length > 1024) return fail(413, '연결 코드 입력이 너무 깁니다.');
            }
            const value = (new URLSearchParams(body).get('code') ?? '').replace(/[\s-]/gu, '').toUpperCase();
            const provided = Buffer.from(value);
            const expected = Buffer.from(pairingCode);
            const valid = provided.length === expected.length && timingSafeEqual(provided, expected);
            if (!valid) { rate.failures++; return fail(403, '연결 코드가 일치하지 않습니다. 브라우저 뒤로 가기를 눌러 다시 입력해 주세요.'); }
            rate.failures = 0;
            for (const [token, saved] of sessions) if (saved.expires <= Date.now()) sessions.delete(token);
            if (sessions.size >= 30) return fail(429, '연결 가능한 기기 수를 초과했습니다.');
            const token = randomBytes(24).toString('base64url');
            sessions.set(token, { address: context.remoteAddress!, expires: Date.now() + SESSION_MS });
            response.setHeader('Set-Cookie', `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${SESSION_MS / 1000}`);
            response.statusCode = 303;
            response.setHeader('Location', '/');
            response.end();
            return;
          }
          if (request.method === 'GET' && (route === '/' || header('accept')?.includes('text/html'))) {
            response.setHeader('Content-Type', 'text/html; charset=utf-8');
            response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
            response.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CBT 기기 연결</title><style>body{font-family:system-ui,sans-serif;background:#f4f5fa;color:#20253b;margin:0;padding:28px}main{max-width:420px;margin:12vh auto;background:white;padding:28px;border-radius:18px}input,button{font:inherit;width:100%;box-sizing:border-box;padding:14px;margin-top:12px;border-radius:10px}input{border:1px solid #cdd2df}button{border:0;background:#6756d9;color:white}p{line-height:1.6;color:#586174}</style><main><h1>CBT 기기 연결</h1><p>Mac CBT 화면의 휴대폰 연결에서 표시된 연결 코드를 입력하세요.</p><form method="post" action="/__local-book/pair"><label for="code">연결 코드</label><input id="code" name="code" required maxlength="20" autocomplete="off" autocapitalize="characters" placeholder="Mac에 표시된 코드"><button type="submit">이 기기 연결</button></form><p>Mac과 같은 Wi-Fi에서 사용할 수 있습니다.</p></main></html>');
            return;
          }
          return fail(403, '먼저 Mac에 표시된 연결 코드로 이 기기를 연결해 주세요.');
        }
        if (!route.startsWith('/__local-book/')) return next();
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
        response.removeHeader('Access-Control-Allow-Origin');
        response.removeHeader('Access-Control-Allow-Credentials');
        response.removeHeader('Access-Control-Allow-Headers');
        response.removeHeader('Access-Control-Allow-Methods');
        if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); return fail(405, 'GET만 지원합니다.'); }
        if (request.url?.includes('?') || !['/__local-book/network', '/__local-book/metadata', '/__local-book/archive'].includes(route)) return fail(404, '지원하지 않는 요청입니다.');
        if (route === '/__local-book/network') {
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          const port = /:([0-9]+)$/u.exec(context.host ?? '')?.[1] ?? '4183';
          response.end(JSON.stringify({ enabled: lanAccess, urls: local && lanAccess ? [...new Set(interfaces.map(({ address }) => `http://${address}:${port}/`))] : [], pairingCode: local && lanAccess ? pairingCode : '', paired: local || paired }));
          return;
        }
        if (!validLocalBookArchivePath(path)) return fail(404, '로컬 교재 ZIP이 설정되지 않았습니다.');
        let file: Awaited<ReturnType<typeof open>> | undefined;
        try {
          file = await open(path, 'r');
          const stat = await file.stat();
          if (!stat.isFile() || stat.size < 1) { await file.close(); file = undefined; return fail(404, '로컬 교재 ZIP을 사용할 수 없습니다.'); }
          if (stat.size > MAX_LOCAL_BOOK_ARCHIVE_BYTES) { await file.close(); file = undefined; return fail(413, '교재 ZIP은 256MB 이하만 지원합니다.'); }
          if (route === '/__local-book/metadata') {
            await file.close(); file = undefined;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ name: basename(path), size: stat.size }));
            return;
          }
          response.setHeader('Content-Type', 'application/zip');
          response.setHeader('Content-Length', String(stat.size));
          const filename = encodeURIComponent(basename(path)).replace(/['()*]/gu, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
          response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${filename}`);
          const source = file.createReadStream({ start: 0, end: stat.size - 1, autoClose: true });
          file = undefined;
          await pipeline(source, response);
        } catch {
          if (file) await file.close().catch(() => undefined);
          if (response.headersSent || response.destroyed) response.destroy();
          else fail(404, '로컬 교재 ZIP을 읽지 못했습니다.');
        }
      });
  }
}
