import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CBTScreen, ResultPage, resultItems } from './App';
import { ExplanationText, explanationParagraphs } from './ExplanationText';
import { answeredQuestionIds, selectSubjectSet, PRACTICE_BATCH_SIZE } from './lib/bookSelection';
import { resolveCbtShortcut, type CbtShortcutState } from './lib/cbtShortcuts';
import { readReadingScale, saveReadingScale } from './lib/readingPrefs';
import type { ActiveSession, Attempt, Question, UserData } from './types';

// Synthetic unit fixtures only; never imported into the app or derived from the book.
const SUBJECT = '전기설비 안전관리';
function question(index: number, overrides: Partial<Question> = {}): Question {
  return {
    id: `unit-set-${index}`, year: null, round: '', originalSubject: SUBJECT,
    prompt: `검증용 지문 ${index}`, choices: ['보기 가', '보기 나', '보기 다', '보기 라'],
    answer: 2, explanation: '첫 번째 핵심 문장. 두 번째 보충 문장.', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
const pool = Array.from({ length: 30 }, (_, index) => question(index));
const fixedRandom = () => 0.42;
const noHistory = { attempts: [], reviewStates: new Map() };

describe('subject 20-question sets', () => {
  it('draws at most 20 unique questions from the subject pool without changing the pool', () => {
    const before = structuredClone(pool);
    const set = selectSubjectSet([...pool, pool[0]], 'random', noHistory, fixedRandom);
    expect(set).toHaveLength(PRACTICE_BATCH_SIZE);
    expect(new Set(set.map((item) => item.id)).size).toBe(PRACTICE_BATCH_SIZE);
    expect(set.every((item) => pool.some((source) => source.id === item.id))).toBe(true);
    expect(pool).toEqual(before);
  });

  it('keeps a short pool short instead of filling the gap', () => {
    const short = pool.slice(0, 17);
    expect(selectSubjectSet(short, 'random', noHistory, fixedRandom)).toHaveLength(17);
    expect(selectSubjectSet([], 'wrong', noHistory, fixedRandom)).toEqual([]);
  });

  it('puts never-answered questions first for unseen order', () => {
    const attempts = [{ questionIds: pool.slice(0, 25).map((item) => item.id), answers: Object.fromEntries(pool.slice(0, 25).map((item) => [item.id, 1])) }];
    const set = selectSubjectSet(pool, 'unseen', { attempts, reviewStates: new Map() }, fixedRandom);
    expect(set.slice(0, 5).map((item) => item.id).sort()).toEqual(pool.slice(25).map((item) => item.id).sort());
  });

  it('orders wrong, then unanswered, then unseen, then latest-correct for wrong-first order', () => {
    const attempts = [{ questionIds: ['unit-set-0', 'unit-set-1', 'unit-set-2'], answers: { 'unit-set-0': 1, 'unit-set-2': 2 } }];
    const reviewStates = new Map<string, 'wrong' | 'unanswered'>([['unit-set-0', 'wrong'], ['unit-set-1', 'unanswered']]);
    const set = selectSubjectSet(pool.slice(0, 4), 'wrong', { attempts, reviewStates }, fixedRandom);
    expect(set.map((item) => item.id)).toEqual(['unit-set-0', 'unit-set-1', 'unit-set-3', 'unit-set-2']);
    expect([...answeredQuestionIds(attempts)].sort()).toEqual(['unit-set-0', 'unit-set-2']);
  });
});

describe('CBT keyboard shortcuts', () => {
  const state: CbtShortcutState = { checked: false, canCheck: true, index: 3, total: 20, choiceCount: 4 };
  it('maps 1–4, arrows and Enter', () => {
    expect(resolveCbtShortcut({ key: '3', target: 'other' }, state)).toEqual({ type: 'answer', value: 3 });
    expect(resolveCbtShortcut({ key: '5', target: 'other' }, state)).toBeNull();
    expect(resolveCbtShortcut({ key: 'ArrowLeft', target: 'other' }, state)).toEqual({ type: 'move', index: 2 });
    expect(resolveCbtShortcut({ key: 'ArrowRight', target: 'answer-option' }, state)).toEqual({ type: 'move', index: 4 });
    expect(resolveCbtShortcut({ key: 'Enter', target: 'answer-option' }, state)).toEqual({ type: 'check' });
  });
  it('leaves typing, IME composition, modifiers, focused controls and locked answers alone', () => {
    expect(resolveCbtShortcut({ key: '1', target: 'text-input' }, state)).toBeNull();
    expect(resolveCbtShortcut({ key: '1', target: 'other', isComposing: true }, state)).toBeNull();
    expect(resolveCbtShortcut({ key: 'ArrowLeft', target: 'other', modifier: true }, state)).toBeNull();
    expect(resolveCbtShortcut({ key: 'Enter', target: 'control' }, state)).toBeNull();
    expect(resolveCbtShortcut({ key: '2', target: 'other' }, { ...state, checked: true })).toBeNull();
    expect(resolveCbtShortcut({ key: 'Enter', target: 'other' }, { ...state, canCheck: false })).toBeNull();
    expect(resolveCbtShortcut({ key: 'ArrowRight', target: 'other' }, { ...state, index: 19 })).toBeNull();
  });
});

describe('explanation lead emphasis', () => {
  it('labels the first paragraph only when asked and keeps the paragraph logic', () => {
    const text = '첫 번째 핵심 문장.\n두 번째 보충 문장.';
    expect(explanationParagraphs(text)).toEqual(['첫 번째 핵심 문장.', '두 번째 보충 문장.']);
    const html = renderToStaticMarkup(<ExplanationText className="feedback-explanation" text={text} emphasizeLead/>);
    expect(html).toBe('<div class="feedback-explanation has-lead"><p class="explanation-lead"><span class="explanation-lead-label">핵심</span>첫 번째 핵심 문장.</p><p>두 번째 보충 문장.</p></div>');
    expect(renderToStaticMarkup(<ExplanationText className="x" text="한 문장뿐." emphasizeLead/>)).toBe('<div class="x"><p>한 문장뿐.</p></div>');
    expect(renderToStaticMarkup(<ExplanationText className="x" text={text}/>)).not.toContain('explanation-lead');
  });
});

const user: UserData = { key: 'state', attempts: [], bookmarks: [], theme: 'light' };
const noop = () => {};
function session(overrides: Partial<ActiveSession> = {}): ActiveSession {
  return {
    id: 'unit-set-session', title: `${SUBJECT} · 무작위 20문항`, scheme: 'legacy', mode: 'subject',
    questionIds: pool.slice(0, 20).map((item) => item.id), answers: {}, markedIds: [], index: 0,
    startedAt: '2026-01-01T00:00:00.000Z', deadlineAt: 1_800_000, feedbackEnabled: true, ...overrides,
  };
}
function screen(width: number, active: ActiveSession) {
  vi.stubGlobal('window', { innerWidth: width, innerHeight: 900 });
  const current = pool[active.index];
  return renderToStaticMarkup(<CBTScreen question={current} session={active} questions={pool} remaining={1200} user={user}
    onAnswer={noop} onCheck={noop} onNavigate={noop} onBookmark={noop} onMarked={noop} onSubmit={noop} onExit={noop}
    readingScale="lg" onReadingScale={noop}/>);
}
afterEach(() => vi.unstubAllGlobals());

describe('CBT answer glance and layouts', () => {
  it('marks the correct choice and my wrong choice with icon and text, not color alone', () => {
    const html = screen(390, session({ answers: { 'unit-set-0': 4 }, checkedQuestionIds: ['unit-set-0'] }));
    expect(html).toContain('정답 ②');
    expect(html).toContain('내 답 ④ · 오답');
    expect(html).toContain(`<span class="glance-chip meta">${SUBJECT}</span>`);
    expect(html).toContain('<span class="choice-result-label">정답</span>');
    expect(html).toContain('<span class="choice-result-label wrong">내 답 · 오답</span>');
    expect(html).toContain('<span class="explanation-lead-label">핵심</span>');
    expect(html).toContain('<button class="cbt-primary-action">다음 문제</button>');
  });

  it('offers check as the mobile primary action and keeps it disabled until an answer is chosen', () => {
    expect(screen(390, session())).toContain('<button class="cbt-primary-action" disabled="">정답 확인</button>');
    expect(screen(390, session({ answers: { 'unit-set-0': 1 } }))).toContain('<button class="cbt-primary-action">정답 확인</button>');
    expect(screen(390, session())).toContain('aria-label="글자 크기 크게"');
  });

  it('uses the two-column practice layout with an always-open number strip at 1024px and wider', () => {
    const html = screen(1024, session());
    expect(html).toContain('class="cbt-content practice-layout"');
    expect(html).toContain('id="cbt-question-list"');
    expect(html).toContain('class="explanation-placeholder"');
    expect(screen(1023, session())).not.toContain('practice-layout');
  });

  it('keeps the formal exam layout unchanged on wide screens', () => {
    const html = screen(1280, session({ title: '전체 무작위 정식 모의고사', feedbackEnabled: false, mode: 'random' }));
    expect(html).not.toContain('practice-layout');
    expect(html).not.toContain('cbt-explanation-column');
    expect(html).toContain('<button class="cbt-submit cbt-primary-action">제출</button>');
  });
});

describe('subject set results', () => {
  function attempt(correctCount: number, overrides: Partial<Attempt> = {}): Attempt {
    const ids = pool.slice(0, 20).map((item) => item.id);
    const answers: Record<string, number> = {};
    ids.forEach((id, index) => { if (index < correctCount) answers[id] = 2; else if (index < 18) answers[id] = 1; });
    return { id: 'unit-set-attempt', title: `${SUBJECT} · 오답 우선 20문항`, scheme: 'legacy', mode: 'subject', questionIds: ids, answers,
      startedAt: '2026-01-01T00:00:00.000Z', submittedAt: '2026-01-01T00:20:00.000Z', remainingSeconds: 0, feedbackEnabled: true, ...overrides };
  }
  const render = (value: Attempt) => renderToStaticMarkup(<ResultPage attempt={value} questions={pool} onAgain={noop} onMistakes={noop}/>);

  it('shows the Q-Net subject cutoff below 40 points without a pass verdict', () => {
    const html = render(attempt(7));
    expect(html).toContain(`${SUBJECT} 35점`);
    expect(html).toContain('과락 (40점 미만)');
    expect(html).toContain('<em>과락</em>');
    expect(html).not.toContain('합격을 축하합니다');
    const passing = render(attempt(8));
    expect(passing).toContain(`${SUBJECT} 40점`);
    expect(passing).toContain('과락 기준 통과 (40점 이상)');
    expect(passing).not.toContain('<em>과락</em>');
  });

  it('renders a 20-cell grid with correct, wrong and unanswered states and one explanation card per question', () => {
    const value = attempt(7);
    const items = resultItems(value, pool);
    expect(items.map((item) => item.state).filter((state) => state === 'correct')).toHaveLength(7);
    expect(items.map((item) => item.state).filter((state) => state === 'wrong')).toHaveLength(11);
    expect(items.map((item) => item.state).filter((state) => state === 'unanswered')).toHaveLength(2);
    const html = render(value);
    expect(html.match(/class="result-cell /g)).toHaveLength(20);
    expect(html).toContain('aria-label="1번 정답, 해설로 이동"');
    expect(html).toContain('aria-label="20번 미응답, 해설로 이동"');
    expect(html.match(/class="result-explanation-card /g)).toHaveLength(20);
    expect(html).toContain('오답만 보기');
    expect(html).toContain('내 답 없음 · 미응답');
  });

  it('does not mark a cutoff for mixed-subject practice', () => {
    expect(render(attempt(3, { mode: 'random', title: '전체 무작위 20문제' }))).not.toContain('과락');
  });
});

describe('reading size preference', () => {
  beforeEach(() => vi.stubGlobal('localStorage', undefined));
  it('falls back to the default when storage is missing or throws, and saves when available', () => {
    expect(readReadingScale()).toBe('md');
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    expect(readReadingScale()).toBe('md');
    expect(() => saveReadingScale('xl')).not.toThrow();
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
    saveReadingScale('xl');
    expect(readReadingScale()).toBe('xl');
    store.set([...store.keys()][0], 'huge');
    expect(readReadingScale()).toBe('md');
  });
});
