import type { SchemeId } from './types';

export const BOOK_SUBJECTS = [
  '산업재해 예방 및 안전보건교육',
  '인간공학 및 위험성 평가·관리',
  '기계·기구 및 설비 안전관리',
  '전기설비 안전관리',
  '화학설비 안전관리',
  '건설공사 안전관리',
] as const;

export const SUBJECTS: Record<SchemeId, string[]> = {
  legacy: [...BOOK_SUBJECTS],
  revised: [
    '산업재해 예방 및 안전보건교육',
    '인간공학 및 위험성 평가·관리',
    '기계·기구 및 설비 안전관리',
    '전기 및 화학설비 안전관리',
    '건설공사 안전관리',
  ],
};

export const SCHEME_INFO: Record<SchemeId, { label: string; count: number; minutes: number; years: string }> = {
  legacy: { label: '2024–2026 출제기준', count: 120, minutes: 180, years: '2024–2026' },
  revised: { label: '2027–2029 출제기준', count: 100, minutes: 150, years: '2027–2029' },
};

export const EMPTY_USER_DATA = {
  key: 'state' as const,
  attempts: [],
  bookmarks: [],
  theme: 'light' as const,
};
