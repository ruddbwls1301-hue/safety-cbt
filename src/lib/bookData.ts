import type { BookQuestionMetadata, Question } from '../types';

export const BOOK_DATASET_ID = 'industrial-safety-cbt-book' as const;
const BOOK_SUBJECTS = ['산업재해 예방 및 안전보건교육', '인간공학 및 위험성 평가·관리', '기계·기구 및 설비 안전관리', '전기설비 안전관리', '화학설비 안전관리', '건설공사 안전관리'];
const BOOK_EXAMS = [{ round: 1, year: 2025 }, { round: 2, year: 2024 }, { round: 3, year: 2022 }];
export type BookInspectionReport = {
  total: number;
  subjects: { subjectNo: number; subject: string; count: number }[];
  exams: { round: number; year: number; count: number }[];
  unknownYears: number;
  pending: number;
  flags: number;
  flagCounts: Record<string, number>;
  blankChoices: number;
  graphics: number;
  questionImages: number;
  formula: number;
  referenceErrors: number;
  missingExplanations: number;
  imageCount: number;
  questionImageCandidates: number;
  missingImages: string[];
  duplicateIds: string[];
  invalid: { originalId: string; index: number; issues: string[] }[];
  fatalErrors: string[];
  warnings: string[];
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function rowsFor(parsed: unknown): Record<string, unknown>[] {
  const rows = Array.isArray(parsed) ? parsed : record(parsed).questions;
  if (!Array.isArray(rows)) throw new Error('questions 배열을 찾지 못했습니다.');
  return rows.map(record);
}
function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}
function flagsFor(row: Record<string, unknown>): string[] {
  return Array.isArray(row.reviewFlags) ? row.reviewFlags.filter((flag): flag is string => typeof flag === 'string') : [];
}
function graphicsFor(row: Record<string, unknown>): boolean {
  return row.choicesAreImages === true || flagsFor(row).some((flag) => /choices_are_images/u.test(flag));
}
function formulaFor(row: Record<string, unknown>): boolean {
  return flagsFor(row).some((flag) => /formula/u.test(flag));
}
function sourceImagePath(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\\/gu, '/').replace(/^\.\//u, '') : '';
}
export function bookReviewImagePath(raw: unknown): string {
  const row = record(raw);
  return sourceImagePath(row.explanationImage) || sourceImagePath(row.image);
}
export function bookQuestionImagePath(raw: unknown): string {
  return sourceImagePath(record(raw).questionImage);
}
export function stableBookQuestionId(originalId: string): string {
  return `${BOOK_DATASET_ID}:question:${encodeURIComponent(originalId)}`;
}
export function stableBookImageId(relativePath: string): string {
  return `${BOOK_DATASET_ID}:image:${encodeURIComponent(relativePath.replace(/\\/gu, '/').replace(/^\.\//u, ''))}`;
}
function roundFor(row: Record<string, unknown>): BookQuestionMetadata['examRound'] {
  if (row.section !== 'exam') return null;
  const value = record(row.examRound);
  const round = positiveInteger(value.round);
  const year = positiveInteger(value.year);
  return round && year && year >= 1900 && year <= 2099 ? { round, year } : null;
}
function substantiveExplanation(text: unknown): boolean {
  return typeof text === 'string' && text.replace(/(?:이전|앞|위|다음)\s*해설\s*참조/gu, '').trim().length > 0;
}
function referenceIssue(start: Record<string, unknown>, byId: Map<string, Record<string, unknown>>): string | undefined {
  if (!start.explanationRef) return;
  const seen = new Set<string>([String(start.id)]);
  let reference: unknown = start.explanationRef;
  while (reference) {
    if (typeof reference !== 'string') return '해설 참조 형식 오류';
    if (seen.has(reference)) return '해설 참조 순환';
    seen.add(reference);
    const target = byId.get(reference);
    if (!target) return `해설 참조 대상 누락: ${reference}`;
    if (target.explanationRef) { reference = target.explanationRef; continue; }
    if (!substantiveExplanation(target.explanation)) return `해설 참조 대상 내용 누락: ${reference}`;
    return;
  }
}
function structuralIssues(row: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const subjectNo = positiveInteger(row.subjectNo);
  if (!subjectNo || subjectNo > 6) issues.push('과목 번호 확인 필요');
  else if (typeof row.subject !== 'string' || row.subject.replace(/\s/gu, '') !== BOOK_SUBJECTS[subjectNo - 1].replace(/\s/gu, '')) issues.push('원본 과목명과 과목 번호 불일치');
  if (row.section !== 'exam' && (!positiveInteger(row.section) || row.section !== subjectNo)) issues.push('책 분류와 과목 번호 불일치');
  if (!positiveInteger(row.no)) issues.push('원본 문항 번호 확인 필요');
  if (row.section === 'exam') {
    const exam = roundFor(row);
    if (!exam || !BOOK_EXAMS.some((item) => item.round === exam.round && item.year === exam.year)) issues.push('실전 연도·회차 확인 필요');
  } else if (row.examRound != null) issues.push('과목별 문항의 실전 회차 메타데이터 확인 필요');
  if (typeof row.question !== 'string' || !row.question.trim()) issues.push('문제 지문 누락');
  if (!Array.isArray(row.choices) || row.choices.length !== 4 || row.choices.some((choice) => typeof choice !== 'string')) issues.push('보기 형식 오류');
  if (!positiveInteger(row.answer) || Number(row.answer) > 4) issues.push('정답 번호 확인 필요');
  if (typeof row.answerSource !== 'string' || !row.answerSource.trim()) issues.push('정답 출처 확인 필요');
  if (row.explanationRef !== null && (typeof row.explanationRef !== 'string' || !row.explanationRef.trim())) issues.push('해설 참조 형식 확인 필요');
  if (!Array.isArray(row.reviewFlags) || row.reviewFlags.some((flag) => typeof flag !== 'string')) issues.push('검수 플래그 형식 확인 필요');
  const source = record(row.source);
  if (!positiveInteger(source.page) || !Array.isArray(source.spans) || !source.spans.length || source.spans.some((value) => {
    const span = record(value);
    return !positiveInteger(span.page) || !['L', 'R'].includes(String(span.column)) || typeof span.y0 !== 'number' || typeof span.y1 !== 'number' || span.y0 < 0 || span.y1 > 1 || span.y0 >= span.y1;
  })) issues.push('원본 페이지 위치 확인 필요');
  const reviewPath = bookReviewImagePath(row);
  if (!reviewPath || /(?:^|\/)\.\.(?:\/|$)/u.test(reviewPath) || reviewPath.startsWith('/') || /^[a-z]:/iu.test(reviewPath)) issues.push('검수 원본 이미지 경로 확인 필요');
  const questionPath = bookQuestionImagePath(row);
  if (row.questionImage != null && (!questionPath || /(?:^|\/)\.\.(?:\/|$)/u.test(questionPath) || questionPath.startsWith('/') || /^[a-z]:/iu.test(questionPath))) issues.push('시험용 후보 이미지 경로 확인 필요');
  return issues;
}

export function inspectBookData(parsed: unknown, imagePaths: Iterable<string>): BookInspectionReport {
  const report: BookInspectionReport = { total: 0, subjects: BOOK_SUBJECTS.map((subject, index) => ({ subjectNo: index + 1, subject, count: 0 })), exams: BOOK_EXAMS.map((exam) => ({ ...exam, count: 0 })), unknownYears: 0, pending: 0, flags: 0, flagCounts: {}, blankChoices: 0, graphics: 0, questionImages: 0, formula: 0, referenceErrors: 0, missingExplanations: 0, imageCount: 0, questionImageCandidates: 0, missingImages: [], duplicateIds: [], invalid: [], fatalErrors: [], warnings: [] };
  let rows: Record<string, unknown>[];
  try { rows = rowsFor(parsed); } catch (error) { report.fatalErrors.push(String(error)); return report; }
  const paths = new Set(Array.from(imagePaths, (path) => path.replace(/\\/gu, '/').replace(/^\.\//u, '')));
  report.imageCount = paths.size;
  report.total = report.pending = rows.length;
  if (!rows.length) report.fatalErrors.push('문항 배열이 비어 있습니다.');
  const byId = new Map<string, Record<string, unknown>>();
  rows.forEach((row, index) => {
    if (typeof row.id !== 'string' || !row.id.trim()) { report.fatalErrors.push(`${index + 1}번째 문항의 원본 ID가 없습니다.`); return; }
    if (byId.has(row.id)) report.duplicateIds.push(row.id);
    else byId.set(row.id, row);
  });
  if (report.duplicateIds.length) report.fatalErrors.push(`원본 ID 중복 ${report.duplicateIds.length}건`);
  rows.forEach((row, index) => {
    const issues = structuralIssues(row);
    const exam = roundFor(row);
    if (row.section === 'exam') {
      const group = report.exams.find((item) => item.round === exam?.round && item.year === exam.year);
      if (group) group.count++;
    } else {
      const group = report.subjects.find((item) => item.subjectNo === row.subjectNo);
      if (group) group.count++;
    }
    if (!exam) report.unknownYears++;
    const flags = flagsFor(row);
    if (flags.length) report.flags++;
    for (const flag of flags) report.flagCounts[flag] = (report.flagCounts[flag] ?? 0) + 1;
    if (Array.isArray(row.choices) && row.choices.some((choice) => typeof choice !== 'string' || !choice.trim())) { report.blankChoices++; issues.push('보기 빈칸: 원본 대조 필요'); }
    if (graphicsFor(row)) { report.graphics++; issues.push('그림 보기: 시험용 이미지 대조 필요'); }
    if (row.questionHasImage === true) report.questionImages++;
    if (formulaFor(row)) { report.formula++; issues.push('수식: 원본 대조 필요'); }
    const refIssue = referenceIssue(row, byId);
    if (refIssue) { report.referenceErrors++; issues.push(refIssue); }
    if (!row.explanationRef && !substantiveExplanation(row.explanation)) { report.missingExplanations++; issues.push('해설 내용 누락: 원본 대조 필요'); }
    const path = bookReviewImagePath(row);
    if (!paths.has(path)) { report.missingImages.push(path || String(row.id)); issues.push('검수 원본 이미지 누락'); }
    const questionPath = bookQuestionImagePath(row);
    if (questionPath) {
      report.questionImageCandidates++;
      if (!paths.has(questionPath)) { report.missingImages.push(questionPath); issues.push('시험용 후보 이미지 누락'); }
    }
    if (issues.length) report.invalid.push({ originalId: String(row.id ?? ''), index, issues });
  });
  if (report.missingImages.length) report.warnings.push(`검수 이미지 누락 ${report.missingImages.length}건은 승인할 수 없습니다.`);
  if (report.referenceErrors) report.warnings.push(`해설 참조 오류 ${report.referenceErrors}건은 검수와 참조 수정이 필요합니다.`);
  report.warnings.push('원본 PDF가 포함되어 있지 않습니다. JPG 원본 대조 후 문항별 승인이 필요합니다.');
  return report;
}

export function convertBookData(parsed: unknown): Question[] {
  const rows = rowsFor(parsed);
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  const seen = new Set<string>();
  const createdAt = new Date().toISOString();
  return rows.map((row, sourceOrder) => {
    if (typeof row.id !== 'string' || !row.id.trim() || seen.has(row.id)) throw new Error('누락되거나 중복된 원본 문항 ID가 있습니다.');
    seen.add(row.id);
    const subjectNo = positiveInteger(row.subjectNo);
    const examRound = roundFor(row);
    const source = record(row.source);
    const issues = structuralIssues(row);
    const refIssue = referenceIssue(row, byId);
    if (refIssue) issues.push(refIssue);
    const book: BookQuestionMetadata = {
      datasetId: BOOK_DATASET_ID, originalId: row.id, originalNumber: positiveInteger(row.no), sourceOrder,
      section: row.section === 'exam' ? 'exam' : positiveInteger(row.section) ?? 0,
      subjectNo, sourceSubject: typeof row.subject === 'string' ? row.subject : '', examRound,
      frequency: typeof row.frequency === 'number' && Number.isFinite(row.frequency) ? row.frequency : null,
      answerSource: typeof row.answerSource === 'string' ? row.answerSource : null,
      reviewFlags: flagsFor(row), ...(typeof row.bookNote === 'string' ? { bookNote: row.bookNote } : {}),
      questionHasImage: row.questionHasImage === true, choicesAreImages: row.choicesAreImages === true, textVerified: row.textVerified === true,
      source: { page: positiveInteger(source.page), spans: Array.isArray(source.spans) ? source.spans : [] },
      explanationRef: typeof row.explanationRef === 'string' && row.explanationRef ? row.explanationRef : null,
      reviewImageId: bookReviewImagePath(row) ? stableBookImageId(bookReviewImagePath(row)) : '',
      ...(bookQuestionImagePath(row) ? { sourceQuestionImageId: stableBookImageId(bookQuestionImagePath(row)) } : {}),
      review: { sourceCompared: false, flagsChecked: false, explanationChecked: false, examImageSafe: false },
      issues, rawRecord: structuredClone(row),
    };
    return {
      id: stableBookQuestionId(row.id), year: examRound?.year ?? null, round: examRound ? `실전 ${examRound.round}회차` : '',
      originalSubject: subjectNo && subjectNo <= 6 ? BOOK_SUBJECTS[subjectNo - 1] : '',
      prompt: typeof row.question === 'string' ? row.question : '',
      choices: Array.isArray(row.choices) ? row.choices.map((choice) => typeof choice === 'string' ? choice : '') : ['', '', '', ''],
      answer: positiveInteger(row.answer) && Number(row.answer) <= 4 ? Number(row.answer) : null,
      explanation: typeof row.explanation === 'string' ? row.explanation : '', status: 'pending',
      source: '산업안전기사 교재 ZIP', ...(book.source.page ? { sourcePage: book.source.page } : {}), createdAt, book,
    };
  });
}

function isBookExamWithoutExplanation(question: Question): boolean {
  const raw = record(question.book?.rawRecord);
  return question.book?.section === 'exam' && raw.section === 'exam' && typeof raw.explanation === 'string'
    && !raw.explanation.trim() && raw.explanationRef === null && !question.explanation.trim() && question.book.explanationRef === null;
}

function bookApprovalIssuesFor(question: Question, allQuestions: Question[], requireManual: boolean): string[] {
  const book = question.book;
  if (!book) return [];
  const issues: string[] = [];
  if (book.datasetId !== BOOK_DATASET_ID || typeof book.originalId !== 'string' || !book.originalId || question.id !== stableBookQuestionId(book.originalId)) issues.push('교재 문항 ID 확인 필요');
  if (!book.subjectNo || book.subjectNo < 1 || book.subjectNo > 6 || question.originalSubject !== BOOK_SUBJECTS[book.subjectNo - 1]) issues.push('책 과목 번호 확인 필요');
  if (!book.originalNumber || !Number.isInteger(book.originalNumber) || !Number.isInteger(book.sourceOrder) || book.sourceOrder < 0) issues.push('책 번호·순서 확인 필요');
  const location = record(book.source);
  if (!positiveInteger(location.page) || !Array.isArray(location.spans) || !location.spans.length || location.spans.some((value) => {
    const span = record(value);
    return !positiveInteger(span.page) || !['L', 'R'].includes(String(span.column)) || typeof span.y0 !== 'number' || typeof span.y1 !== 'number' || !Number.isFinite(span.y0) || !Number.isFinite(span.y1) || span.y0 < 0 || span.y1 > 1 || span.y0 >= span.y1;
  })) issues.push('원본 페이지 위치 확인 필요');
  if (!Array.isArray(book.reviewFlags) || book.reviewFlags.some((flag) => typeof flag !== 'string') || !book.rawRecord || typeof book.rawRecord !== 'object' || !Array.isArray(book.issues) || book.issues.some((issue) => typeof issue !== 'string')) issues.push('교재 검수 메타데이터 확인 필요');
  if (book.section === 'exam') {
    if (!book.examRound || !BOOK_EXAMS.some((exam) => exam.round === book.examRound?.round && exam.year === book.examRound.year) || question.year !== book.examRound.year || question.round !== `실전 ${book.examRound.round}회차`) issues.push('실전 연도·회차 확인 필요');
  } else if (question.year !== null || question.round || book.examRound !== null || book.section !== book.subjectNo) issues.push('과목별 문항은 연도 미상으로 보존해야 합니다.');
  if (!book.reviewImageId) issues.push('검수 원본 이미지 연결 필요');
  if (requireManual && !book.review?.sourceCompared) issues.push('검수용 JPG 원본 대조 필요');
  if (requireManual && book.reviewFlags?.length && !book.review?.flagsChecked) issues.push('검수 플래그 확인 필요');
  if (requireManual && !book.review?.explanationChecked) issues.push('해설 원본 대조 확인 필요');
  if (!question.prompt.trim()) issues.push('문제 지문 누락');
  if (question.answer === null || !Number.isInteger(question.answer) || question.answer < 1 || question.answer > 4) issues.push('정답 번호 확인 필요');
  if (!book.answerSource) issues.push('정답 출처 확인 필요');
  const rawRecord = record(book.rawRecord);
  const needsImage = graphicsFor(rawRecord) || formulaFor(rawRecord) || book.questionHasImage === true || rawRecord.questionHasImage === true || book.choicesAreImages === true;
  const blankChoices = question.choices.length !== 4 || question.choices.some((choice) => !choice.trim());
  const safeExamImage = Boolean(book.examImageId && book.examImageId !== book.reviewImageId && book.review?.examImageSafe);
  if ((needsImage || blankChoices) && !safeExamImage) issues.push('그림·수식·빈 보기의 시험용 이미지 크롭 및 정답 미노출 확인 필요');
  if (book.examImageId && !safeExamImage) issues.push('시험용 이미지 정답 미노출 확인 필요');
  if (book.explanationRef) {
    const byId = new Map(allQuestions.filter((item) => item.book?.datasetId === BOOK_DATASET_ID).map((item) => [item.book!.originalId, { id: item.book!.originalId, explanation: item.explanation, explanationRef: item.book!.explanationRef }]));
    const refIssue = referenceIssue({ id: book.originalId, explanation: question.explanation, explanationRef: book.explanationRef }, byId);
    if (refIssue) issues.push(refIssue);
  }
  if (!book.explanationRef && !substantiveExplanation(question.explanation) && !isBookExamWithoutExplanation(question)) issues.push('해설 내용 또는 완전한 해설 참조 필요');
  const savedIssues = Array.isArray(book.issues) ? book.issues.filter((issue): issue is string => typeof issue === 'string') : ['교재 검수 메타데이터 확인 필요'];
  if (requireManual && savedIssues.some((issue) => issue.startsWith('해설 참조')) && !book.review?.explanationChecked) issues.push('해설 참조 수정 후 대조 확인 필요');
  // Immutable source metadata requires a corrected import, not merely an acknowledgement.
  const immutable = savedIssues.filter((issue) => !/^(?:해설 참조|문제 지문|보기 형식|정답 번호)/u.test(issue));
  issues.push(...immutable);
  return [...new Set(issues)];
}

/** Derives machine approval eligibility without claiming a human compared the source image. */
export function automaticBookApprovalIssues(question: Question, allQuestions: Question[]): string[] {
  const book = question.book;
  if (!book) return ['교재 가져오기 문항이 아닙니다.'];
  const issues = bookApprovalIssuesFor(question, allQuestions, false);
  const raw = record(book.rawRecord);
  const originalIssues = structuralIssues(raw);
  issues.push(...originalIssues);
  if (Array.isArray(book.issues) && book.issues.length) issues.push('원본 추출 오류는 수동 검수가 필요합니다.');
  if (!['ocr', 'manual_visual_check', 'ocr_digit_crop'].includes(String(book.answerSource))) issues.push('정답 출처가 자동 승인 대상이 아닙니다.');
  if (!Array.isArray(book.reviewFlags) || book.reviewFlags.some((flag) => flag !== 'choices_markers_inferred') || flagsFor(raw).some((flag) => flag !== 'choices_markers_inferred')) issues.push('수동 검수가 필요한 원본 플래그');
  if (graphicsFor(raw) || book.choicesAreImages || raw.questionHasImage === true || book.questionHasImage || formulaFor(raw) || (Array.isArray(book.reviewFlags) && book.reviewFlags.some((flag) => /formula/u.test(flag)))) issues.push('그림·그래프·수식 문항은 수동 검수가 필요합니다.');
  if (question.imageDataUrl || book.examImageId) issues.push('이미지가 연결된 문항은 수동 검수가 필요합니다.');
  if (!Array.isArray(question.choices) || question.choices.length !== 4 || question.choices.some((choice) => typeof choice !== 'string' || !choice.trim())) issues.push('빈 보기 문항은 자동 승인할 수 없습니다.');
  if (typeof raw.questionHasImage !== 'boolean' || typeof raw.choicesAreImages !== 'boolean' || typeof raw.textVerified !== 'boolean') issues.push('원본 이미지·OCR 메타데이터 확인 필요');
  if (book.section === 'exam' ? raw.frequency !== null : typeof raw.frequency !== 'number' || !Number.isInteger(raw.frequency) || raw.frequency < 0) issues.push('원본 출제 빈도 형식 확인 필요');
  const originalRound = roundFor(raw);
  const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
  const reviewPath = bookReviewImagePath(raw);
  const questionPath = bookQuestionImagePath(raw);
  if (raw.id !== book.originalId || raw.no !== book.originalNumber || raw.subjectNo !== book.subjectNo || raw.section !== book.section || raw.subject !== book.sourceSubject || !same(originalRound, book.examRound) || raw.frequency !== book.frequency || raw.answerSource !== book.answerSource || !same(flagsFor(raw), book.reviewFlags) || raw.questionHasImage !== book.questionHasImage || raw.choicesAreImages !== book.choicesAreImages || raw.textVerified !== book.textVerified || positiveInteger(record(raw.source).page) !== book.source?.page || !same(record(raw.source).spans, book.source?.spans) || !reviewPath || stableBookImageId(reviewPath) !== book.reviewImageId || (questionPath ? stableBookImageId(questionPath) : undefined) !== book.sourceQuestionImageId) issues.push('원본과 변환된 출처 메타데이터 불일치');
  if (raw.question !== question.prompt || !same(raw.choices, question.choices) || raw.answer !== question.answer || raw.explanation !== question.explanation || (raw.explanationRef || null) !== book.explanationRef) issues.push('원본에서 수정된 문항은 수동 검수가 필요합니다.');
  return [...new Set(issues)];
}

function hasValidAutomaticReview(question: Question, allQuestions: Question[]): boolean {
  const automatic = question.book?.review?.automatic;
  return Boolean(automatic && automatic.method === 'structure-v1' && typeof automatic.archiveHash === 'string'
    && /^[0-9a-f]{64}$/u.test(automatic.archiveHash) && typeof automatic.checkedAt === 'string' && Number.isFinite(Date.parse(automatic.checkedAt))
    && Boolean(automatic.explanationUnavailable) === isBookExamWithoutExplanation(question)
    && automaticBookApprovalIssues(question, allQuestions).length === 0);
}

export function bookApprovalIssues(question: Question, allQuestions: Question[]): string[] {
  return bookApprovalIssuesFor(question, allQuestions, !hasValidAutomaticReview(question, allQuestions));
}

export type AutomaticBookApprovalResult = {
  questions: Question[];
  approved: Question[];
  pending: Question[];
  pendingReasons: Record<string, string[]>;
  reasonCounts: Record<string, number>;
};
export function autoApproveBookQuestions(questions: Question[], archiveHash: string): AutomaticBookApprovalResult {
  if (!/^[0-9a-f]{64}$/u.test(archiveHash)) throw new Error('자동 승인할 원본 ZIP SHA-256을 확인해 주세요.');
  const checkedAt = new Date().toISOString();
  const approved: Question[] = [];
  const pending: Question[] = [];
  const pendingReasons: Record<string, string[]> = {};
  const reasonCounts: Record<string, number> = {};
  const updated = questions.map((question) => {
    if (!question.book || question.status === 'verified') return question;
    const issues = automaticBookApprovalIssues(question, questions);
    if (issues.length) {
      pending.push(question);
      pendingReasons[question.id] = issues;
      for (const issue of issues) reasonCounts[issue] = (reasonCounts[issue] ?? 0) + 1;
      return question;
    }
    const next: Question = {
      ...question, status: 'verified',
      book: { ...question.book, review: { ...question.book.review, automatic: { checkedAt, method: 'structure-v1', archiveHash, ...(isBookExamWithoutExplanation(question) ? { explanationUnavailable: true as const } : {}) } } },
    };
    approved.push(next);
    return next;
  });
  return { questions: updated, approved, pending, pendingReasons, reasonCounts };
}

export function isBookQuestionEligible(question: Question, allQuestions?: Question[]): boolean {
  if (question.status !== 'verified') return false;
  if (question.book) return bookApprovalIssues(question, allQuestions ?? [question]).length === 0;
  return typeof question.prompt === 'string' && Boolean(question.prompt.trim())
    && question.answer != null && Number.isInteger(question.answer) && question.answer >= 1 && question.answer <= 4
    && Array.isArray(question.choices) && question.choices.length === 4
    && question.choices.every((choice) => typeof choice === 'string' && Boolean(choice.trim()));
}
