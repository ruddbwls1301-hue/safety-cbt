import { describe, expect, it } from 'vitest';
import { convertBookData, isBookQuestionEligible } from './bookData';
import { bookReviewFlagLabel, bookReviewIssueMatches, bookReviewStatusMatches, questionNeedsReview } from './bookReview';

function question(overrides: Record<string, unknown> = {}) {
  return convertBookData({ questions: [{
    id: 'review-sample', section: 1, subjectNo: 1, subject: '산업재해 예방 및 안전보건교육', no: 8,
    frequency: 3, examRound: null, question: '검수용 지문', choices: ['가', '나', '다', '라'], answer: 2,
    answerSource: 'manual_visual_check', explanation: '검수용 해설', explanationRef: null,
    image: 'images/review-sample.jpg', source: { page: 2, spans: [{ page: 2, column: 'L', y0: 0.1, y1: 0.5 }] },
    questionHasImage: false, choicesAreImages: false, textVerified: false, reviewFlags: [], ...overrides,
  }] })[0];
}

describe('book review queue helpers', () => {
  it('surfaces verified rows that fail the real CBT eligibility gate without mutating their status', () => {
    const item = question();
    item.status = 'verified';
    expect(isBookQuestionEligible(item, [item])).toBe(false);
    expect(questionNeedsReview(item, [item])).toBe(true);
    expect(bookReviewStatusMatches(item, [item], 'needs-review')).toBe(true);
    expect(bookReviewStatusMatches(item, [item], 'eligible')).toBe(false);
    expect(item.status).toBe('verified');
  });

  it('keeps a manually checked eligible row out of the review queue', () => {
    const item = question();
    item.status = 'verified';
    item.book!.review = { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: false };
    expect(isBookQuestionEligible(item, [item])).toBe(true);
    expect(questionNeedsReview(item, [item])).toBe(false);
    expect(bookReviewStatusMatches(item, [item], 'eligible')).toBe(true);
    expect(bookReviewStatusMatches(item, [item], 'needs-review')).toBe(false);
  });

  it('matches image and formula review categories from preserved source flags', () => {
    const item = question({ questionHasImage: true, reviewFlags: ['formula_check_image'] });
    expect(bookReviewIssueMatches(item, 'visual')).toBe(true);
    expect(bookReviewIssueMatches(item, 'formula')).toBe(true);
    expect(bookReviewIssueMatches(item, 'flags')).toBe(true);
  });

  it('matches explanation references and uncertain source metadata', () => {
    const item = question({ frequency: null, explanation: '', explanationRef: 'missing-target', reviewFlags: ['frequency_unread'] });
    expect(bookReviewIssueMatches(item, 'explanation')).toBe(true);
    expect(bookReviewIssueMatches(item, 'metadata')).toBe(true);
  });

  it('explains known source flags while preserving unknown flag codes', () => {
    expect(bookReviewFlagLabel('choices_markers_inferred')).toContain('원본과 보기');
    expect(bookReviewFlagLabel('vendor_specific_flag')).toContain('원본 JPG');
  });
});
