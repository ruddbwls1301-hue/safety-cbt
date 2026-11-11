import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CBTScreen, MobileNavigation } from './App';
import { BookExamImage, BookStoredImage } from './BookImages';
import type { ActiveSession, Question, UserData } from './types';

const question: Question = {
  id: 'mobile-unit-only', year: null, round: '', originalSubject: '산업재해 예방 및 안전보건교육',
  prompt: '합성 모바일 검증 지문', choices: ['가', '나', '다', '라'], answer: 2,
  explanation: '합성 모바일 검증 해설', status: 'verified', createdAt: '2026-10-12T00:00:00Z',
  book: { datasetId: 'industrial-safety-cbt-book', originalId: 'mobile-unit-source', originalNumber: 145,
    sourceOrder: 144, section: 1, subjectNo: 1, sourceSubject: '산업재해 예방 및 안전보건교육',
    examRound: null, frequency: null, answerSource: 'synthetic-test', reviewFlags: [],
    questionHasImage: true, choicesAreImages: false, textVerified: true, source: { page: 1, spans: [] },
    explanationRef: null, reviewImageId: 'mobile-review', examImageId: 'mobile-exam',
    review: { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: true },
    issues: [], rawRecord: { syntheticOnly: true } },
};
const session: ActiveSession = {
  id: 'mobile-unit-session', title: '모바일 20문항 합성 검증', scheme: 'legacy', mode: 'subject',
  questionIds: [question.id, ...Array.from({ length: 19 }, (_, i) => `mobile-unit-${i}`)], answers: {},
  markedIds: [], index: 0, startedAt: '2026-10-12T00:00:00Z', deadlineAt: 1_800_000, feedbackEnabled: true,
};
const user: UserData = { key: 'state', bookmarks: [], attempts: [], theme: 'light' };
const noop = () => {};
function screen(width: number, overrides: Partial<ActiveSession> = {}, height = 844) {
  vi.stubGlobal('window', { innerWidth: width, innerHeight: height });
  return renderToStaticMarkup(<CBTScreen question={question} questions={[question]} session={{ ...session, ...overrides }}
    remaining={1200} user={user} onAnswer={noop} onCheck={noop} onNavigate={noop} onBookmark={noop}
    onMarked={noop} onSubmit={noop} onExit={noop}/>);
}
afterEach(() => vi.unstubAllGlobals());

describe('Phase 5 mobile navigation and CBT controls', () => {
  it('keeps five primary mobile targets and an explicit more menu control', () => {
    const html = renderToStaticMarkup(<MobileNavigation view="mistakes" onNavigate={noop}/>);
    expect(html.match(/<button/g)).toHaveLength(5);
    expect(html).toContain('aria-label="모바일 메뉴"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('<span>복습</span>');
    expect(html).toContain('<span>더보기</span>');
    expect(html).not.toContain('id="mobile-more-menu"');
  });
  it('marks more as active for book registration without changing data', () => {
    const before = structuredClone(user);
    const html = renderToStaticMarkup(<MobileNavigation view="bookImport" onNavigate={noop}/>);
    expect(html).toContain('<button class="active" aria-expanded="false"');
    expect(user).toEqual(before);
  });
  it.each([320, 390, 430, 700])('starts with the question map folded at %ipx and retains 20-question progress', (width) => {
    const html = screen(width);
    expect(html).toContain('cbt-question-map collapsed');
    expect(html).toContain('aria-label="문제 목록 열기" aria-expanded="false"');
    expect(html).not.toContain('id="cbt-question-list"');
    expect(html).toContain('<div class="cbt-mobile-bar"><span>1 / 20</span>');
    expect(html).toContain('문제 145');
    expect(html).not.toContain(question.explanation);
  });
  it.each([[844, 390], [950, 500]])('folds the map for a landscape %i×%i mobile viewport', (width, height) => {
    expect(screen(width, {}, height)).toContain('cbt-question-map collapsed');
  });

  it('keeps the desktop map open and identifies the current question accessibly', () => {
    const html = screen(1200);
    expect(html).toContain('aria-label="문제 목록 닫기" aria-expanded="true" aria-controls="cbt-question-list"');
    expect(html).toContain('id="cbt-question-list"');
    expect(html).toContain('aria-current="step" aria-label="145번 문제 미응답"');
  });
  it('retains selected answers, checked feedback and the final completion action after a restored session', () => {
    const saved = { ...session, index: 19, answers: { [question.id]: 2 }, checkedQuestionIds: [question.id], markedIds: [question.id] };
    const before = structuredClone(saved);
    const html = screen(390, saved);
    expect(html).toContain('<div class="cbt-mobile-bar"><span>20 / 20</span>');
    expect(html).toContain('정답입니다');
    expect(html).toContain(question.explanation);
    expect(html).toContain('검토 표시 해제');
    expect(html).toContain('학습 완료');
    expect(saved).toEqual(before);
  });
});

describe('mobile image loading keeps existing answer exposure gates', () => {
  it('announces the stored image loading state without displaying an answer-bearing fallback', () => {
    const html = renderToStaticMarkup(<BookStoredImage imageId="mobile-exam" purpose="exam" alt="합성 시험 이미지"/>);
    expect(html).toContain('role="status"');
    expect(html).toContain('이미지 불러오는 중');
    expect(html).not.toContain('mobile-review');
    expect(html).not.toContain('<a');
  });
  it('does not display unsafe images or an exam ID pointing at the review image', () => {
    const unsafe = { ...question, book: { ...question.book!, review: { ...question.book!.review, examImageSafe: false } } };
    const sameId = { ...question, book: { ...question.book!, examImageId: question.book!.reviewImageId } };
    expect(renderToStaticMarkup(<BookExamImage question={unsafe}/>)).toBe('');
    expect(renderToStaticMarkup(<BookExamImage question={sameId}/>)).toBe('');
  });
});
