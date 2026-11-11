/** Joins an app-relative path with the deploy base ("/" at a domain root, "/repo/dir/" on GitHub Pages). */
export function withBase(base: string, path: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return prefix + path.replace(/^\/+/u, '');
}

export function appUrl(path: string): string {
  return withBase(import.meta.env.BASE_URL || '/', path);
}
