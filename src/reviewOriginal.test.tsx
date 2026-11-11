import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuestionCollection } from './App';
import type { Question } from './types';

// Synthetic unit fixtures only; never imported into the app or derived from the book.
function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'unit-review-original', year: null, round: '', originalSubject: '산업재해 예방 및 안전보건교육',
    prompt: '복습 원본 해설 검증용 지문', choices: ['가', '나', '다', '라'], answer: 3,
    explanation: '복습 검증용 해설', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z', ...overrides,
  };
}
const book = (id: string, explanation = '복습 검증용 해설'): Question => question({
  id, explanation,
  book: {
    datasetId: 'industrial-safety-cbt-book', originalId: `unit-${id}`, originalNumber: 153, sourceOrder: 152,
    section: 1, subjectNo: 1, sourceSubject: '검증용 과목', examRound: null, frequency: null, answerSource: 'unit-fixture',
    reviewFlags: [], questionHasImage: false, choicesAreImages: false, textVerified: true,
    source: { page: 9, spans: [] }, explanationRef: null, reviewImageId: `unit-review-image-${id}`,
    review: { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: false },
    issues: [], rawRecord: { unitFixtureOnly: true },
  },
});
const render = (questions: Question[]) => renderToStaticMarkup(<QuestionCollection questions={questions} allQuestions={questions}
  scheme="legacy" onBookmark={() => {}} bookmarks={[]} onEdit={() => {}} reviewStates={new Map([[questions[0].id, 'wrong' as const]])}/>);

describe('review list original explanation image', () => {
  it('offers the book original explanation image, folded and not loaded until opened', () => {
    const html = render([book('a', '첫 줄\n둘째 줄\n셋째 줄\n넷째 줄')]);
    expect(html).toContain('<details class="feedback-original review-original"><summary>책 원본 해설 이미지 보기</summary></details>');
    expect(html).not.toContain('이미지 불러오는 중');
    expect(html.indexOf('collection-explanation-details')).toBeLessThan(html.indexOf('review-original'));
  });
  it('shows nothing extra for questions without a book image', () => {
    expect(render([question()])).not.toContain('review-original');
  });
});
