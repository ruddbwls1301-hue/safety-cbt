import type { ErrorReport, ErrorReportField, Question } from '../types';

export const ERROR_REPORT_NOTE_LIMIT = 500;

export const ERROR_REPORT_FIELDS: { value: ErrorReportField; label: string }[] = [
  { value: 'prompt', label: '지문' },
  { value: 'choices', label: '보기' },
  { value: 'answer', label: '정답' },
  { value: 'explanation', label: '해설' },
  { value: 'symbol', label: '기호·수식' },
  { value: 'image', label: '이미지' },
  { value: 'other', label: '기타' },
];

const FIELD_ORDER = ERROR_REPORT_FIELDS.map((field) => field.value);

export function errorReportFieldLabel(field: ErrorReportField): string {
  return ERROR_REPORT_FIELDS.find((item) => item.value === field)?.label ?? field;
}

/** The one unresolved report for a question, if any. Reopening the sheet edits it instead of stacking duplicates. */
export function openReportFor(reports: readonly ErrorReport[] | undefined, questionId: string): ErrorReport | undefined {
  return reports?.find((report) => report.questionId === questionId && report.status === 'open');
}

export function errorReportInputError(fields: readonly ErrorReportField[], note: string): string | undefined {
  if (!fields.length && !note.trim()) return '오류 위치를 고르거나 내용을 적어 주세요.';
  if (note.length > ERROR_REPORT_NOTE_LIMIT) return `내용은 ${ERROR_REPORT_NOTE_LIMIT}자까지 적을 수 있습니다.`;
  return undefined;
}

/**
 * Create or update the open report for a question. Resolved reports are history and are never modified here.
 * Returns the full new list; the input list is not mutated.
 */
export function upsertErrorReport(
  reports: readonly ErrorReport[] | undefined,
  question: Question,
  input: { fields: readonly ErrorReportField[]; note: string },
  context: ErrorReport['context'],
  now: string,
  makeId: () => string,
): ErrorReport[] {
  const list = reports ?? [];
  const fields = FIELD_ORDER.filter((field) => input.fields.includes(field));
  const note = input.note.trim().slice(0, ERROR_REPORT_NOTE_LIMIT);
  const existing = openReportFor(list, question.id);
  if (existing) return list.map((report) => report.id === existing.id ? { ...report, fields, note, context, updatedAt: now } : report);
  return [...list, {
    id: makeId(), questionId: question.id, originalId: question.book?.originalId,
    fields, note, context, status: 'open', createdAt: now, updatedAt: now,
  }];
}

export function setErrorReportStatus(reports: readonly ErrorReport[] | undefined, id: string, status: ErrorReport['status'], now: string): ErrorReport[] {
  return (reports ?? []).map((report) => report.id === id ? { ...report, status, updatedAt: now } : report);
}

export function removeErrorReport(reports: readonly ErrorReport[] | undefined, id: string): ErrorReport[] {
  return (reports ?? []).filter((report) => report.id !== id);
}

/**
 * Export for the correction workflow: each report carries the question's current text as `current`,
 * so a later patch can be applied only when the stored field still matches that value.
 * Images are referenced by id only; no image data or answer-bearing review image is embedded.
 */
export function errorReportExport(reports: readonly ErrorReport[], questions: readonly Question[], exportedAt: string) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  return {
    kind: 'industrial-safety-cbt-error-reports',
    version: 1,
    exportedAt,
    counts: { total: reports.length, open: reports.filter((report) => report.status === 'open').length },
    reports: reports.map((report) => {
      const question = byId.get(report.questionId);
      return {
        ...report,
        question: question ? {
          subject: question.currentSubject || question.originalSubject,
          originalNumber: question.book?.originalNumber ?? null,
          sourcePage: question.book?.source.page ?? question.sourcePage ?? null,
          current: { prompt: question.prompt, choices: question.choices, answer: question.answer, explanation: question.explanation },
        } : null,
      };
    }),
  };
}
