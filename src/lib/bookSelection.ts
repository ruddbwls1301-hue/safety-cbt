import type { Question, SchemeId, SessionMode } from '../types';
import { SUBJECTS } from '../constants';
import { isBookQuestionEligible } from './bookData';
import { canonicalSubjectLabel, subjectFor } from './questions';

export type BookRound = { year: number; round: number };

export const PRACTICE_BATCH_SIZE = 20;

export function practiceBatchCount(pool: readonly Question[]): number {
  return Math.ceil(new Set(pool.map((question) => question.id)).size / PRACTICE_BATCH_SIZE);
}

/** Partition an already eligible pool; retain source numbering and never change approval state. */
export function selectPracticeBatch(pool: readonly Question[], index: number): Question[] {
  if (!Number.isSafeInteger(index) || index < 0) return [];
  const seen = new Set<string>();
  const ordered = pool.flatMap((question, poolIndex) => {
    if (seen.has(question.id)) return [];
    seen.add(question.id);
    const sourceOrder = question.book?.sourceOrder;
    return [{ question, poolIndex, sourceOrder: typeof sourceOrder === 'number' && Number.isFinite(sourceOrder)
      ? sourceOrder : Number.POSITIVE_INFINITY }];
  }).sort((left, right) => {
    if (left.sourceOrder !== right.sourceOrder) return left.sourceOrder < right.sourceOrder ? -1 : 1;
    if (left.sourceOrder === Number.POSITIVE_INFINITY) return left.poolIndex - right.poolIndex;
    return left.question.id < right.question.id ? -1 : left.question.id > right.question.id ? 1 : left.poolIndex - right.poolIndex;
  });
  const start = index * PRACTICE_BATCH_SIZE;
  return ordered.slice(start, start + PRACTICE_BATCH_SIZE).map(({ question }) => question);
}

export const BOOK_EXAM_ROUNDS = [
  { year: 2025, round: 1, count: 115 },
  { year: 2024, round: 2, count: 117 },
  { year: 2022, round: 3, count: 119 },
] as const;

export function bookRoundKey(examRound: BookRound): string {
  return `${examRound.year}:${examRound.round}`;
}

export function bookRoundLabel(examRound: BookRound): string {
  return `${examRound.year}년 실전 ${examRound.round}회차`;
}

/** Book rounds keep their source order and gaps, independently of official exam years. */
export function selectBookRound(questions: Question[], key: string): Question[] {
  if (!BOOK_EXAM_ROUNDS.some((round) => bookRoundKey(round) === key)) return [];
  return questions.filter((question) => question.book?.section === 'exam'
    && question.book.examRound != null
    && bookRoundKey(question.book.examRound) === key
    && isBookQuestionEligible(question, questions))
    .sort((left, right) => (left.book?.sourceOrder ?? 0) - (right.book?.sourceOrder ?? 0) || left.id.localeCompare(right.id));
}

export type PracticePoolOptions = {
  scheme: SchemeId;
  mode: Exclude<SessionMode, 'book-round'>;
  official?: boolean;
  subject?: string;
  year?: string | number | null;
  round?: string;
  wrongIds?: readonly string[];
  bookmarkedIds?: readonly string[];
};

/** Select available practice questions without shuffling or substituting an empty selection. */
export function selectPracticePool(questions: Question[], options: PracticePoolOptions): Question[] {
  const { scheme, mode } = options;
  const official = options.official === true;
  const reviewMode = !official && (mode === 'wrong' || mode === 'bookmarked');
  const officialYears = scheme === 'legacy' ? [2024, 2025, 2026] : [2027, 2028, 2029];
  const selectedSubject = canonicalSubjectLabel(options.subject, scheme);
  if (mode === 'subject' && !SUBJECTS[scheme].includes(selectedSubject ?? '')) return [];
  const selectedYear = options.year === undefined || options.year === null || options.year === '' || options.year === 'all'
    ? null : Number(options.year);
  if (mode === 'round' && selectedYear !== null && !Number.isInteger(selectedYear)) return [];
  const wrongIds = new Set(options.wrongIds ?? []);
  const bookmarkedIds = new Set(options.bookmarkedIds ?? []);
  return questions.filter((question) => {
    if (!isBookQuestionEligible(question, questions)) return false;
    const subject = subjectFor(question, scheme);
    if (!SUBJECTS[scheme].includes(subject ?? '')) return false;
    if (!reviewMode) {
      if (question.book?.section === 'exam') return false;
      if (question.year === null ? official || mode === 'round' : !officialYears.includes(question.year)) return false;
    }
    if (mode === 'subject') return subject === selectedSubject;
    if (mode === 'round') return (selectedYear === null || question.year === selectedYear) && (!options.round || question.round === options.round);
    if (mode === 'wrong') return wrongIds.has(question.id);
    if (mode === 'bookmarked') return bookmarkedIds.has(question.id);
    return true;
  });
}

export type SubjectSetOrder = 'random' | 'unseen' | 'wrong' | 'book';

export const SUBJECT_SET_ORDERS: readonly { id: SubjectSetOrder; label: string; description: string }[] = [
  { id: 'random', label: '무작위', description: '과목 전체에서 무작위 20문항' },
  { id: 'unseen', label: '미풀이 우선', description: '제출 기록에 답이 없는 문항부터' },
  { id: 'wrong', label: '오답 우선', description: '최근 오답 → 미응답 → 미풀이 순' },
  { id: 'book', label: '책 순서 묶음', description: '책 순서대로 20문항씩 나눈 묶음' },
];

export type SubjectSetHistory = {
  attempts: readonly { questionIds: readonly string[]; answers: Readonly<Record<string, number>> }[];
  reviewStates: ReadonlyMap<string, 'wrong' | 'unanswered'>;
};

/** Question ids that received an answer in any submitted attempt. */
export function answeredQuestionIds(attempts: SubjectSetHistory['attempts']): Set<string> {
  const answered = new Set<string>();
  for (const attempt of attempts) {
    for (const id of attempt.questionIds) if (attempt.answers[id] !== undefined) answered.add(id);
  }
  return answered;
}

/**
 * Choose one subject set from an already eligible single-subject pool.
 * Never fills a short pool with other subjects or unreviewed questions; ties are shuffled.
 */
export function selectSubjectSet(pool: readonly Question[], order: Exclude<SubjectSetOrder, 'book'>, history: SubjectSetHistory, random: () => number = Math.random): Question[] {
  const seen = new Set<string>();
  const unique = pool.filter((question) => !seen.has(question.id) && Boolean(seen.add(question.id)));
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]];
  }
  if (order !== 'random') {
    const answered = answeredQuestionIds(history.attempts);
    const rank = (question: Question) => {
      if (order === 'unseen') return answered.has(question.id) ? 1 : 0;
      const state = history.reviewStates.get(question.id);
      if (state === 'wrong') return 0;
      if (state === 'unanswered') return 1;
      return answered.has(question.id) ? 3 : 2;
    };
    unique.sort((left, right) => rank(left) - rank(right));
  }
  return unique.slice(0, PRACTICE_BATCH_SIZE);
}

/** Book frequency filter for subject practice. Frequency = times the question appeared in past exams (book ★×10 + ☆). */
export type FrequencyFilter = 'all' | 'frequent' | 'rare';
export const FREQUENT_MIN_COUNT = 3;
export const FREQUENCY_FILTERS: readonly { id: FrequencyFilter; label: string; description: string }[] = [
  { id: 'all', label: '전체', description: '출제 빈도와 관계없이' },
  { id: 'frequent', label: `${FREQUENT_MIN_COUNT}회 이상 빈출`, description: `책 기준 ${FREQUENT_MIN_COUNT}번 이상 출제된 문항` },
  { id: 'rare', label: `${FREQUENT_MIN_COUNT}회 미만`, description: `${FREQUENT_MIN_COUNT}번 미만으로 출제된 문항` },
];

/** Questions without a recorded frequency (user-added, exam rounds) match only "all"; nothing is guessed. */
export function matchesFrequency(question: Question, filter: FrequencyFilter): boolean {
  if (filter === 'all') return true;
  const frequency = question.book?.frequency;
  if (typeof frequency !== 'number' || !Number.isFinite(frequency)) return false;
  return filter === 'frequent' ? frequency >= FREQUENT_MIN_COUNT : frequency < FREQUENT_MIN_COUNT;
}
