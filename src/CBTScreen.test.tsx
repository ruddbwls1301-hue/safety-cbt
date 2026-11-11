import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CBTScreen } from './App';
import type { ActiveSession, Question, UserData } from './types';

// Synthetic unit fixtures only; these questions are never imported into the app.
function question(overrides: Partial<Question> = {}): Question {
  return {
    id: 'unit-screen-question', year: null, round: '', originalSubject: '산업재해 예방 및 안전보건교육',
    prompt: '화면 표시 동작 검증용 지문', choices: ['검증 보기 가', '검증 보기 나', '검증 보기 다', '검증 보기 라'],
    answer: 2, explanation: '화면 표시 동작 검증용 해설', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function bookQuestion(overrides: Partial<Question> = {}): Question {
  return question({
    book: {
      datasetId: 'industrial-safety-cbt-book', originalId: 'unit-source-id', originalNumber: 145, sourceOrder: 144,
      section: 1, subjectNo: 1, sourceSubject: '검증용 과목', examRound: null, frequency: null, answerSource: 'unit-fixture',
      reviewFlags: [], questionHasImage: false, choicesAreImages: false, textVerified: true,
      source: { page: 9, spans: [] }, explanationRef: null, reviewImageId: 'unit-review-image',
      review: { sourceCompared: true, flagsChecked: true, explanationChecked: true, examImageSafe: false },
      issues: [], rawRecord: { unitFixtureOnly: true },
    },
    ...overrides,
  });
}

function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'unit-screen-session', title: '검증용 20문제 연습', scheme: 'legacy', mode: 'subject',
    questionIds: ['unit-screen-question'], answers: {}, markedIds: [], index: 0,
    startedAt: '2026-01-01T00:00:00.000Z', deadlineAt: 1_800_000, feedbackEnabled: true,
    ...overrides,
  };
}

const user: UserData = { key: 'state', attempts: [], bookmarks: [], theme: 'light' };
const noAction = () => {};

function render(currentQuestion: Question, active: ActiveSession, questions: Question[] = [currentQuestion]) {
  return renderToStaticMarkup(<CBTScreen question={currentQuestion} session={active} questions={questions}
    remaining={1_200} user={user} onAnswer={noAction} onCheck={noAction} onNavigate={noAction}
    onBookmark={noAction} onMarked={noAction} onSubmit={noAction} onExit={noAction}/>);
}

function answerButtons(html: string): string[] {
  return html.match(/<button class="answer-option[^\"]*"[^>]*>[\s\S]*?<\/button>/g) ?? [];
}

beforeEach(() => vi.stubGlobal('window', { innerWidth: 390 }));
afterEach(() => vi.unstubAllGlobals());

describe('CBT immediate answer feedback', () => {
  it('prefers original evidence for a multiline book explanation only after checking', () => {
    const currentQuestion = bookQuestion({ explanation: '합성 표 첫 줄\n합성 표 둘째 줄\n합성 표 셋째 줄\n합성 표 넷째 줄' });
    const unchecked = render(currentQuestion, session({ answers: { [currentQuestion.id]: 2 } }));
    expect(unchecked).not.toContain('feedback-original');
    expect(unchecked).not.toContain('텍스트 해설 보기');
    const checked = render(currentQuestion, session({ answers: { [currentQuestion.id]: 2 }, checkedQuestionIds: [currentQuestion.id] }));
    expect(checked).toContain('<details class="feedback-original" open="">');
    expect(checked).toContain('<details class="feedback-text"><summary>텍스트 해설 보기</summary>');
    expect(checked.indexOf('feedback-original')).toBeLessThan(checked.indexOf('feedback-explanation'));
    // Display reflows single PDF line breaks; the stored explanation itself is unchanged.
    expect(checked).toContain('합성 표 첫 줄 합성 표 둘째 줄 합성 표 셋째 줄 합성 표 넷째 줄');
  });

  it('keeps multiline book explanations hidden in formal exams', () => {
    const currentQuestion = bookQuestion({ explanation: '합성 하나\n합성 둘\n합성 셋\n합성 넷' });
    const html = render(currentQuestion, session({ feedbackEnabled: false, answers: { [currentQuestion.id]: 2 }, checkedQuestionIds: [currentQuestion.id] }));
    expect(html).not.toContain('feedback-original');
    expect(html).not.toContain(currentQuestion.explanation);
  });

  it('keeps the correct answer, explanation, and full review image hidden until checked', () => {
    const currentQuestion = bookQuestion();
    const html = render(currentQuestion, session({ answers: { [currentQuestion.id]: 1 } }));
    expect(html).toContain('정답·해설 확인');
    expect(html).not.toContain('class="practice-feedback');
    expect(html).not.toContain('class="choice-result-label"');
    expect(html).not.toContain('correct-answer');
    expect(html).not.toContain('정답 2번');
    expect(html).not.toContain(currentQuestion.explanation);
    expect(html).not.toContain('책 원본 해설 이미지 보기');
    expect(html).not.toContain('정답 확인 후 보는 교재 원본 해설');
    const buttons = answerButtons(html);
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => !button.includes('disabled=""'))).toBe(true);
  });

  it('shows the exact correct choice and explanation after checking a wrong answer and locks every choice', () => {
    const currentQuestion = question();
    const html = render(currentQuestion, session({ answers: { [currentQuestion.id]: 1 }, checkedQuestionIds: [currentQuestion.id] }));
    expect(html).toContain('오답입니다');
    expect(html).toContain('정답 ②');
    expect(html).toContain('내 답 ① · 오답');
    expect(html).toContain('<p class="feedback-answer">검증 보기 나</p>');
    expect(html).toContain(`<div class="feedback-explanation"><p>${currentQuestion.explanation}</p></div>`);
    expect(html).toContain('role="status"');
    const buttons = answerButtons(html);
    expect(buttons).toHaveLength(4);
    expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true);
    expect(buttons[0]).toContain('wrong-answer');
    expect(buttons[1]).toContain('correct-answer');
    expect(buttons[1]).toContain('class="choice-result-label">정답');
    expect(html).not.toContain('정답·해설 확인');
  });

  it('shows a correct response without changing the choice label or generating a new explanation', () => {
    const currentQuestion = question();
    const html = render(currentQuestion, session({ answers: { [currentQuestion.id]: 2 }, checkedQuestionIds: [currentQuestion.id] }));
    expect(html).toContain('정답입니다');
    expect(html).toContain('내 답 ② · 정답');
    expect(html).not.toContain('wrong-answer');
    expect(html).toContain(currentQuestion.explanation);
  });

  it('never exposes practice feedback in a formal exam even if old checked IDs are present', () => {
    const currentQuestion = bookQuestion();
    const html = render(currentQuestion, session({ title: '전체 무작위 정식 모의고사', feedbackEnabled: false,
      answers: { [currentQuestion.id]: 1 }, checkedQuestionIds: [currentQuestion.id] }));
    expect(html).not.toContain('class="practice-feedback');
    expect(html).not.toContain('정답·해설 확인');
    expect(html).not.toContain('correct-answer');
    expect(html).not.toContain('wrong-answer');
    expect(html).not.toContain(currentQuestion.explanation);
    expect(html).not.toContain('책 원본 해설 이미지 보기');
    expect(answerButtons(html).every((button) => !button.includes('disabled=""'))).toBe(true);
  });

  it('explains missing book explanation data rather than fabricating a solution', () => {
    const currentQuestion = bookQuestion({ explanation: '' });
    const html = render(currentQuestion, session({ answers: { [currentQuestion.id]: 2 }, checkedQuestionIds: [currentQuestion.id] }));
    expect(html).toContain('원본 교재 데이터에 해설이 제공되지 않았습니다.');
    expect(html).toContain('책 원본 해설 이미지 보기');
    expect(html).toContain('<details class="feedback-original">');
    expect(html).not.toContain('<details class="feedback-original" open');
  });

  it('resolves a book explanation reference from the existing question bank after checking', () => {
    const currentQuestion = bookQuestion({ explanation: '검증용 해설 참조 안내' });
    currentQuestion.book!.explanationRef = 'unit-reference-source';
    const referenceQuestion = bookQuestion({ id: 'unit-reference-question', explanation: '참조 대상 검증용 해설' });
    referenceQuestion.book!.originalId = 'unit-reference-source';
    const html = render(currentQuestion, session({ answers: { [currentQuestion.id]: 2 }, checkedQuestionIds: [currentQuestion.id] }), [currentQuestion, referenceQuestion]);
    expect(html).toContain('[unit-reference-source 해설]');
    expect(html).toContain(referenceQuestion.explanation);
    expect(html).not.toContain('해설 참조 확인 필요');
  });

  it('renders prompt and explanation markup as text', () => {
    const currentQuestion = question({ prompt: '<script>unitTestOnly()</script>', explanation: '<img src=x onerror="unitTestOnly()">' });
    const html = render(currentQuestion, session({ answers: { [currentQuestion.id]: 2 }, checkedQuestionIds: [currentQuestion.id] }));
    expect(html).toContain('&lt;script&gt;unitTestOnly()&lt;/script&gt;');
    expect(html).toContain('&lt;img src=x onerror=&quot;unitTestOnly()&quot;&gt;');
    expect(html).not.toContain('<script>unitTestOnly()');
    expect(html).not.toContain('<img src=x');
  });

  it('disables checking until a choice is selected and for a missing correct answer', () => {
    const currentQuestion = question();
    const unanswered = render(currentQuestion, session());
    expect(unanswered).toContain('<button class="button primary" disabled="">정답·해설 확인</button>');
    const missingAnswer = render(question({ answer: null }), session({ answers: { [currentQuestion.id]: 1 } }));
    expect(missingAnswer).toContain('<button class="button primary" disabled="">정답·해설 확인</button>');
    expect(missingAnswer).not.toContain('class="practice-feedback');
  });
});

describe('CBT mobile batch progress', () => {
  it('shows batch position out of 20 while retaining the original book number on the question', () => {
    const currentQuestion = bookQuestion();
    const ids = Array.from({ length: 20 }, (_, index) => index === 3 ? currentQuestion.id : `unit-mobile-question-${index}`);
    const html = render(currentQuestion, session({ questionIds: ids, index: 3 }));
    expect(html).toContain('<span>문제 145</span>');
    expect(html).toContain('<div class="cbt-mobile-bar"><span>4 / 20</span>');
    expect(html).not.toContain('<div class="cbt-mobile-bar"><span>145 / 20</span>');
  });

  it('uses the remaining batch length and provides completion on its last question', () => {
    const currentQuestion = bookQuestion();
    const ids = ['unit-mobile-question-0', 'unit-mobile-question-1', currentQuestion.id];
    const html = render(currentQuestion, session({ questionIds: ids, index: 2 }));
    expect(html).toContain('<div class="cbt-mobile-bar"><span>3 / 3</span>');
    expect(html).toContain('<button aria-label="다음 문제" disabled="">');
    expect(html).toContain('학습 완료');
  });
});
