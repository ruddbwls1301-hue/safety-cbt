import { isBookQuestionEligible } from './bookData';
import type { Question } from '../types';
import { needsSymbolReview } from './symbolReview';

export type BookReviewIssueFilter = 'all' | 'visual' | 'formula' | 'flags' | 'explanation' | 'metadata' | 'symbol';
export type BookReviewStatusFilter = 'needs-review' | 'eligible' | 'all';

const FLAG_LABELS: Record<string, string> = {
  choices_markers_inferred: '보기 구분 기호를 자동으로 추정했습니다. 원본과 보기를 대조하세요.',
  formula_check_image: '수식이 포함되어 있습니다. JPG 원본에서 수식과 기호를 대조하세요.',
  frequency_unread: '출제 빈도를 읽지 못했습니다. 빈도를 추정하지 말고 원본 메모를 확인하세요.',
  duplicate_number_in_book: '책에서 문항 번호가 중복됩니다. 원본 ID와 페이지를 확인하세요.',
};

export function bookReviewFlagLabel(flag: string): string {
  return FLAG_LABELS[flag] ?? '원본 메타데이터에 저장된 확인 항목입니다. 원본 JPG와 대조하세요.';
}

export function questionNeedsReview(question: Question, allQuestions: Question[]): boolean {
  return !isBookQuestionEligible(question, allQuestions);
}

export function bookReviewIssueMatches(question: Question, filter: BookReviewIssueFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'symbol') return needsSymbolReview(question);
  const book = question.book;
  if (!book) return filter === 'metadata' || filter === 'explanation' && !question.explanation.trim();
  const flags = Array.isArray(book.reviewFlags) ? book.reviewFlags : [];
  const raw = book.rawRecord && typeof book.rawRecord === 'object' ? book.rawRecord : {};
  switch (filter) {
    case 'visual':
      return book.questionHasImage || book.choicesAreImages || raw.graphics === true || raw.choicesAreImages === true
        || flags.some((flag) => /image|graphic|graph|figure|그림|그래프/iu.test(flag))
        || Boolean(book.examImageId && !book.review?.examImageSafe);
    case 'formula':
      return flags.some((flag) => /formula|수식/iu.test(flag)) || raw.formulaCheck === true;
    case 'flags':
      return flags.length > 0 || (Array.isArray(book.issues) && book.issues.length > 0) || Boolean(question.duplicateOf);
    case 'explanation':
      return Boolean(book.explanationRef) || !question.explanation.trim() || !book.review?.explanationChecked;
    case 'metadata':
      return !book.originalId || !book.originalNumber || !book.subjectNo || !book.source?.page || !book.answerSource
        || (book.section !== 'exam' && book.frequency == null) || (Array.isArray(book.issues) && book.issues.some((issue) => /메타데이터|빈도|페이지 위치|과목 번호|책 번호|연도·회차|원본과 변환|출처 확인|문항 ID/iu.test(issue)))
        || flags.some((flag) => /frequency|duplicate|metadata|number/iu.test(flag));
  }
}

export function bookReviewStatusMatches(question: Question, allQuestions: Question[], filter: BookReviewStatusFilter, eligibleIds?: ReadonlySet<string>): boolean {
  if (filter === 'all') return true;
  const eligible = eligibleIds ? eligibleIds.has(question.id) : isBookQuestionEligible(question, allQuestions);
  return filter === 'eligible' ? eligible : !eligible;
}
