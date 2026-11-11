/** Per-device display preference; kept out of IndexedDB so study records stay untouched. */
export type ReadingScale = 'md' | 'lg' | 'xl';

export const READING_SCALES: readonly { id: ReadingScale; label: string }[] = [
  { id: 'md', label: '보통' },
  { id: 'lg', label: '크게' },
  { id: 'xl', label: '아주 크게' },
];

const STORAGE_KEY = 'industrial-safety-cbt.reading-scale';

function isReadingScale(value: unknown): value is ReadingScale {
  return value === 'md' || value === 'lg' || value === 'xl';
}

export function readReadingScale(): ReadingScale {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isReadingScale(saved) ? saved : 'md';
  } catch {
    return 'md';
  }
}

export function saveReadingScale(scale: ReadingScale): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, scale);
  } catch {
    // Private mode or blocked storage: the choice still applies until the app closes.
  }
}
