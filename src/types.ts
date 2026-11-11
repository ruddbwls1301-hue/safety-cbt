export type SchemeId = 'legacy' | 'revised';
export type ReviewStatus = 'pending' | 'verified';
export type Question = {
  id: string;
  year: number | null;
  round: string;
  originalSubject: string;
  currentSubject?: string;
  prompt: string;
  choices: string[];
  answer: number | null;
  explanation: string;
  status: ReviewStatus;
  source?: string;
  sourcePage?: number;
  sourceDocumentId?: string;
  imageDataUrl?: string;
  duplicateOf?: string;
  createdAt: string;
  book?: BookQuestionMetadata;
};

export type BookQuestionMetadata = {
  datasetId: 'industrial-safety-cbt-book';
  originalId: string;
  originalNumber: number | null;
  sourceOrder: number;
  section: number | 'exam';
  subjectNo: number | null;
  sourceSubject: string;
  examRound: { round: number; year: number } | null;
  frequency: number | null;
  answerSource: string | null;
  reviewFlags: string[];
  questionHasImage: boolean;
  choicesAreImages: boolean;
  textVerified: boolean;
  bookNote?: string;
  source: { page: number | null; spans: unknown[] };
  explanationRef: string | null;
  reviewImageId: string;
  sourceQuestionImageId?: string;
  examImageId?: string;
  review: {
    sourceCompared: boolean;
    flagsChecked: boolean;
    explanationChecked: boolean;
    examImageSafe: boolean;
    automatic?: { checkedAt: string; method: 'structure-v1'; archiveHash: string; explanationUnavailable?: true };
  };
  issues: string[];
  rawRecord: Record<string, unknown>;
};

export type BookImage = { id: string; blob: Blob; kind: 'review' | 'candidate-exam' | 'exam'; createdAt: string };
export type BookImportManifest = {
  importId: string;
  archiveName: string;
  archiveHash: string;
  sourceMeta: unknown;
  counts: { total: number; added: number; skipped: number; images: number };
  status: 'staging' | 'complete' | 'failed';
  createdAt: string;
  error?: string;
};

export type PdfImportStatus = 'processing' | 'failed' | 'complete';

export type PdfSource = {
  id: string;
  name: string;
  size: number;
  pageCount: number;
  pageStart: number;
  pageEnd: number;
  lastProcessedPage: number;
  importedAt: string;
  status: PdfImportStatus;
  defaultYear: number | null;
  defaultRound: string;
  defaultOriginalSubject: string;
  error?: string;
};

export type PdfExtractionMethod = 'text-layer' | 'ocr';

export type PdfDraft = {
  id: string;
  sourceId: string;
  sourcePage: number;
  sequence: number;
  questionNumber: number | null;
  year: number | null;
  round: string;
  originalSubject: string;
  currentSubject?: string;
  detectedSubjectLabel?: string;
  prompt: string;
  choices: [string, string, string, string];
  answer: number | null;
  explanation: string;
  rawText: string;
  imageDataUrl?: string;
  confidence: number;
  extractionMethod: PdfExtractionMethod;
  status: 'pending' | 'verified';
  issues: string[];
  duplicateOf?: string;
  createdAt: string;
};

export type PdfPageText = {
  id: string;
  sourceId: string;
  sourcePage: number;
  text: string;
  confidence: number;
  extractionMethod: PdfExtractionMethod;
  questionCount: number;
};

export type Attempt = {
  id: string;
  title: string;
  scheme: SchemeId;
  mode: SessionMode;
  questionIds: string[];
  answers: Record<string, number>;
  startedAt: string;
  submittedAt: string;
  remainingSeconds: number;
  feedbackEnabled?: boolean;
  checkedQuestionIds?: string[];
};

export type SessionMode = 'random' | 'subject' | 'round' | 'wrong' | 'bookmarked' | 'book-round';
export type ActiveSession = {
  id: string;
  title: string;
  scheme: SchemeId;
  mode: SessionMode;
  questionIds: string[];
  answers: Record<string, number>;
  markedIds: string[];
  index: number;
  startedAt: string;
  deadlineAt: number;
  feedbackEnabled?: boolean;
  checkedQuestionIds?: string[];
  pausedAt?: number;
};

export type UserData = {
  key: 'state';
  attempts: Attempt[];
  bookmarks: string[];
  activeSession?: ActiveSession;
  savedSessions?: ActiveSession[];
  theme: 'light' | 'dark';
};
