import type { Question, SchemeId } from '../types';
import { randomBrowserId } from './browserCrypto';
import { BOOK_SUBJECTS, SUBJECTS } from '../constants';
import { bookApprovalIssues } from './bookData';

/** Resolve display aliases without rewriting saved subjects or learning records. */
export function canonicalSubjectLabel(value: string | null | undefined, scheme: SchemeId = 'legacy'): string | undefined {
  const label = value?.trim();
  if (!label) return undefined;
  const compact = label.replace(/\s/gu, '');
  return SUBJECTS[scheme].find((subject) => subject.replace(/\s/gu, '') === compact) ?? label;
}

export function subjectFor(question: Question, scheme: SchemeId): string | undefined {
  if (scheme === 'revised') return canonicalSubjectLabel(question.currentSubject, 'revised');
  const subjectNo = question.book?.subjectNo;
  if (Number.isInteger(subjectNo) && subjectNo != null && subjectNo >= 1 && subjectNo <= BOOK_SUBJECTS.length) {
    return BOOK_SUBJECTS[subjectNo - 1];
  }
  return canonicalSubjectLabel(question.originalSubject);
}

export function normalizePrompt(value: string): string {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
}

export function makeId(): string {
  return randomBrowserId();
}

export function parseQuestionImport(value: unknown): Omit<Question, 'id' | 'status' | 'createdAt'>[] {
  const rows = Array.isArray(value) ? value : (value as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('문항 배열을 찾지 못했습니다. [문항, …] 또는 {"questions":[…]} 형식을 사용해 주세요.');
  return rows.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    const choices = item.choices;
    const yearValue = item.year === null || item.year === undefined || item.year === '' ? null : Number(item.year);
    if ((yearValue !== null && (!Number.isInteger(yearValue) || yearValue < 1900 || yearValue > 2099)) || !String(item.prompt ?? '').trim()) {
      throw new Error(`${index + 1}번 문항의 연도 또는 문제 내용을 확인해 주세요.`);
    }
    if (!Array.isArray(choices) || choices.length !== 4 || choices.some((choice) => !String(choice).trim())) {
      throw new Error(`${index + 1}번 문항의 보기는 내용이 있는 4개 항목이어야 합니다.`);
    }
    const originalSubject = String(item.originalSubject ?? '').trim();
    const currentSubject = String(item.currentSubject ?? '').trim();
    if (!SUBJECTS.legacy.includes(canonicalSubjectLabel(originalSubject) ?? '')) throw new Error(`${index + 1}번 문항의 originalSubject가 2024–2026 과목 목록과 일치하지 않습니다.`);
    if (currentSubject && !SUBJECTS.revised.includes(canonicalSubjectLabel(currentSubject, 'revised') ?? '')) throw new Error(`${index + 1}번 문항의 currentSubject가 2027–2029 과목 목록과 일치하지 않습니다.`);
    const answer = Number(item.answer);
    if (!Number.isInteger(answer) || answer < 1 || answer > 4) throw new Error(`${index + 1}번 문항의 정답은 1~4 정수여야 합니다.`);
    return {
      year: yearValue,
      round: String(item.round ?? '').trim(),
      originalSubject,
      ...(currentSubject ? { currentSubject } : {}),
      prompt: String(item.prompt).trim(),
      choices: choices.map((choice) => String(choice).trim()),
      answer,
      explanation: String(item.explanation ?? '').trim(),
      ...(item.source ? { source: String(item.source) } : {}),
      ...(item.sourceDocumentId ? { sourceDocumentId: String(item.sourceDocumentId) } : {}),
      ...(Number.isInteger(Number(item.sourcePage)) && Number(item.sourcePage) > 0 ? { sourcePage: Number(item.sourcePage) } : {}),
      ...(item.imageDataUrl ? { imageDataUrl: String(item.imageDataUrl) } : {}),
    };
  });
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function completeBookMetadata(value: Record<string, unknown>): boolean {
  const subjectNo = value.subjectNo;
  const examRound = record(value.examRound);
  const source = record(value.source);
  const review = record(value.review);
  return value.datasetId === 'industrial-safety-cbt-book'
    && typeof value.originalId === 'string' && Boolean(value.originalId.trim())
    && Number.isInteger(value.originalNumber) && Number(value.originalNumber) > 0
    && Number.isInteger(value.sourceOrder) && Number(value.sourceOrder) >= 0
    && Number.isInteger(subjectNo) && Number(subjectNo) >= 1 && Number(subjectNo) <= 6
    && typeof value.sourceSubject === 'string'
    && (value.frequency === null || typeof value.frequency === 'number' && Number.isFinite(value.frequency))
    && (value.answerSource === null || typeof value.answerSource === 'string')
    && Array.isArray(value.reviewFlags) && value.reviewFlags.every((flag) => typeof flag === 'string')
    && ['questionHasImage', 'choicesAreImages', 'textVerified'].every((key) => typeof value[key] === 'boolean')
    && Array.isArray(value.issues) && value.issues.every((issue) => typeof issue === 'string')
    && Boolean(source && Array.isArray(source.spans) && (source.page === null || Number.isInteger(source.page) && Number(source.page) > 0))
    && (value.explanationRef === null || typeof value.explanationRef === 'string')
    && typeof value.reviewImageId === 'string' && Boolean(record(value.rawRecord))
    && Boolean(review && ['sourceCompared', 'flagsChecked', 'explanationChecked', 'examImageSafe'].every((key) => typeof review[key] === 'boolean'))
    && (value.section === 'exam'
      ? Boolean(examRound && Number.isInteger(examRound.year) && Number.isInteger(examRound.round))
      : Number.isInteger(value.section) && Number(value.section) >= 1 && Number(value.section) <= 6 && value.examRound === null);
}

/** Parse an app backup without dropping book/PDF metadata or guessing missing answers. */
export function parseQuestionBackup(value: unknown): Question[] {
  const envelope = record(value);
  const rows = Array.isArray(value) ? value : envelope?.questionBank ?? envelope?.questions;
  if (!Array.isArray(rows)) throw new Error('백업의 questionBank 문항 배열을 찾지 못했습니다.');
  const ids = new Set<string>();
  const restored = rows.map((raw, index) => {
    const item = record(raw);
    if (!item || typeof item.id !== 'string' || !item.id.trim()) throw new Error(`${index + 1}번 백업 문항의 ID를 확인해 주세요.`);
    if (ids.has(item.id)) throw new Error(`백업에 중복 문항 ID가 있습니다: ${item.id}`);
    ids.add(item.id);
    if (typeof item.prompt !== 'string' || typeof item.originalSubject !== 'string'
      || !Array.isArray(item.choices) || item.choices.length !== 4 || item.choices.some((choice) => typeof choice !== 'string')
      || typeof item.explanation !== 'string' || typeof item.round !== 'string' || typeof item.createdAt !== 'string'
      || item.currentSubject !== undefined && typeof item.currentSubject !== 'string') {
      throw new Error(`${index + 1}번 백업 문항의 문제·보기·해설 구조를 확인해 주세요.`);
    }
    const year = item.year === null || item.year === undefined || item.year === '' ? null : Number(item.year);
    if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2099)) throw new Error(`${index + 1}번 백업 문항의 연도를 확인해 주세요.`);
    const answer = item.answer === null || item.answer === undefined || item.answer === '' ? null : Number(item.answer);
    if (answer !== null && (!Number.isInteger(answer) || answer < 1 || answer > 4)) throw new Error(`${index + 1}번 백업 문항의 정답은 1~4 또는 null이어야 합니다.`);
    const book = item.book === undefined ? undefined : record(item.book);
    if (item.book !== undefined && !book) throw new Error(`${index + 1}번 백업 문항의 도서 메타데이터 구조를 확인해 주세요.`);
    const complete = Boolean(item.prompt.trim()) && answer !== null && (Boolean(book) || item.choices.every((choice) => Boolean(choice.trim())))
      && SUBJECTS.legacy.includes(canonicalSubjectLabel(item.originalSubject) ?? '')
      && (!item.currentSubject || SUBJECTS.revised.includes(canonicalSubjectLabel(item.currentSubject, 'revised') ?? ''))
      && (!book || completeBookMetadata(book));
    // Keep metadata and original stored spellings verbatim; only incomplete rows lose approval.
    return { ...item, year, answer, status: item.status === 'verified' && complete ? 'verified' : 'pending' } as unknown as Question;
  });
  return restored.map((question) => question.book && question.status === 'verified' && bookApprovalIssues(question, restored).length
    ? { ...question, status: 'pending' } : question);
}
