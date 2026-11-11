import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CBTScreen, QuestionCollection, ResultPage } from './App';
import { SymbolHintList } from './SymbolPalette';
import { symbolHints } from './lib/symbolReview';
import type { ActiveSession, Attempt, Question, UserData } from './types';

// Synthetic unit fixtures only; never imported into the app or derived from the book.
const question: Question = {
  id: 'unit-symbol-display', year: null, round: '', originalSubject: '인간공학 및 위험성 평가·관리',
  prompt: '합성 지문: 기호와 의미가 잘못 연결된 것은?', choices: ['□ : 지체', '▽ : 저장', '⇒ : 운반', '○ : 가공'], answer: 1,
  explanation: '합성 해설: 품질검사는 ◇, 지체는 D 이다.', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
};
const user: UserData = { key: 'state', attempts: [], bookmarks: [], theme: 'light' };
const session = (overrides: Partial<ActiveSession> = {}): ActiveSession => ({
  id: 'unit-symbol-session', title: '합성 연습', scheme: 'legacy', mode: 'subject', questionIds: [question.id], answers: {}, markedIds: [], index: 0,
  startedAt: '2026-01-01T00:00:00.000Z', deadlineAt: 1_800_000, feedbackEnabled: true, ...overrides,
});
const noAction = () => {};
beforeEach(() => vi.stubGlobal('window', { innerWidth: 390 }));
afterEach(() => vi.unstubAllGlobals());
const screen = (active: ActiveSession, onEdit?: () => void) => renderToStaticMarkup(<CBTScreen question={question} session={active} questions={[question]}
  remaining={600} user={user} onAnswer={noAction} onCheck={noAction} onNavigate={noAction} onBookmark={noAction} onMarked={noAction} onSubmit={noAction} onExit={noAction} onEdit={onEdit}/>);

describe('stored symbols reach the screen unchanged', () => {
  it('renders every choice symbol verbatim in the CBT screen, in source order', () => {
    const html = screen(session());
    const texts = [...html.matchAll(/<span class="choice-text">([^<]*)<\/span>/gu)].map((match) => match[1]);
    expect(texts).toEqual(question.choices);
    for (const lookalike of ['0 : 지체', 'V : 저장', '5: 운반', '→ : 운반', '◯', '▼']) expect(html).not.toContain(lookalike);
  });
  it('renders explanation symbols verbatim after the answer is checked', () => {
    const html = screen(session({ answers: { [question.id]: 4 }, checkedQuestionIds: [question.id] }));
    expect(html).toContain('품질검사는 ◇, 지체는 D 이다.');
    expect(html).toContain('<p class="feedback-answer">□ : 지체</p>');
  });
  it('renders symbols verbatim in the review list and the result page', () => {
    const attempt: Attempt = { id: 'unit-symbol-attempt', title: '합성 응시', scheme: 'legacy', mode: 'subject', questionIds: [question.id], answers: { [question.id]: 4 }, startedAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-01T00:05:00.000Z', remainingSeconds: 10 };
    const list = renderToStaticMarkup(<QuestionCollection questions={[question]} allQuestions={[question]} scheme="legacy" onBookmark={noAction} bookmarks={[]} onEdit={noAction}/>);
    const result = renderToStaticMarkup(<ResultPage attempt={attempt} questions={[question]} onAgain={noAction} onMistakes={noAction} onEdit={noAction}/>);
    for (const html of [list, result]) { expect(html).toContain('□ : 지체'); expect(html).toContain('◇'); }
    for (const choice of question.choices) expect(result).toContain(`<span class="choice-text">${choice}</span>`);
    expect(result).toContain('오탈자·기호 수정');
  });
});

describe('correction entry points', () => {
  it('offers correction only after the answer is revealed', () => {
    expect(screen(session({ answers: { [question.id]: 4 } }), noAction)).not.toContain('오탈자·기호 수정');
    expect(screen(session({ answers: { [question.id]: 4 }, checkedQuestionIds: [question.id] }), noAction)).toContain('오탈자·기호 수정');
  });
  it('does not offer correction during a scored exam or when no handler is wired', () => {
    expect(screen(session({ feedbackEnabled: false, mode: 'random', answers: { [question.id]: 4 } }), noAction)).not.toContain('오탈자·기호 수정');
    expect(screen(session({ answers: { [question.id]: 4 }, checkedQuestionIds: [question.id] }))).not.toContain('오탈자·기호 수정');
  });
  it('shows hints as a note that states nothing is auto-corrected', () => {
    const html = renderToStaticMarkup(<SymbolHintList hints={symbolHints({ ...question, choices: ['0 : 지체', 'V : 저장', '5: 운반', '0: 가공'] })}/>);
    expect(html).toContain('role="note"');
    expect(html).toContain('자동 수정 없음');
    expect(html).toContain('보기 1');
    expect(renderToStaticMarkup(<SymbolHintList hints={[]}/>)).toBe('');
  });
});
