import { describe, expect, it } from 'vitest';
import { errorReportExport, errorReportInputError, openReportFor, removeErrorReport, setErrorReportStatus, upsertErrorReport } from './errorReports';
import type { Question } from '../types';

// Synthetic fixtures only; no real question bank data.
const question: Question = {
  id: 'unit-report-q', year: null, round: '', originalSubject: '검증용 과목', prompt: '검증용 지문', choices: ['가', '나', '다', '라'],
  answer: 3, explanation: '검증용 해설', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
};
let counter = 0;
const makeId = () => `report-${++counter}`;

describe('error reports', () => {
  it('requires a field or a note and caps the note length', () => {
    expect(errorReportInputError([], '  ')).toMatch('오류 위치');
    expect(errorReportInputError(['prompt'], '')).toBeUndefined();
    expect(errorReportInputError([], '내용만')).toBeUndefined();
    expect(errorReportInputError([], 'x'.repeat(501))).toMatch('500자');
  });

  it('creates one open report per question and edits it instead of stacking duplicates', () => {
    const first = upsertErrorReport(undefined, question, { fields: ['explanation', 'prompt'], note: ' 오타 ' }, 'practice', '2026-01-02T00:00:00.000Z', makeId);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ questionId: 'unit-report-q', fields: ['prompt', 'explanation'], note: '오타', status: 'open', context: 'practice' });
    const edited = upsertErrorReport(first, question, { fields: ['symbol'], note: '기호' }, 'review', '2026-01-03T00:00:00.000Z', makeId);
    expect(edited).toHaveLength(1);
    expect(edited[0]).toMatchObject({ id: first[0].id, fields: ['symbol'], note: '기호', createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z' });
    expect(first[0].note).toBe('오타');
  });

  it('keeps resolved reports as history and opens a new one for a later problem', () => {
    const [report] = upsertErrorReport([], question, { fields: ['answer'], note: '' }, 'exam', '2026-01-02T00:00:00.000Z', makeId);
    const resolved = setErrorReportStatus([report], report.id, 'resolved', '2026-01-04T00:00:00.000Z');
    expect(openReportFor(resolved, question.id)).toBeUndefined();
    const next = upsertErrorReport(resolved, question, { fields: ['choices'], note: '' }, 'review', '2026-01-05T00:00:00.000Z', makeId);
    expect(next).toHaveLength(2);
    expect(next[0]).toMatchObject({ status: 'resolved', fields: ['answer'] });
    expect(removeErrorReport(next, report.id)).toHaveLength(1);
  });

  it('exports the current question text for later before/after patching, without images', () => {
    const reports = upsertErrorReport([], question, { fields: ['prompt'], note: '확인 필요' }, 'practice', '2026-01-02T00:00:00.000Z', makeId);
    const exported = errorReportExport([...reports, { ...reports[0], id: 'gone', questionId: 'missing' }], [question], '2026-01-06T00:00:00.000Z');
    expect(exported.counts).toEqual({ total: 2, open: 2 });
    expect(exported.reports[0].question?.current).toEqual({ prompt: '검증용 지문', choices: ['가', '나', '다', '라'], answer: 3, explanation: '검증용 해설' });
    expect(exported.reports[1].question).toBeNull();
    expect(JSON.stringify(exported)).not.toMatch(/imageDataUrl|reviewImageId|blob/i);
  });
});
