import { ChangeEvent, FormEvent, lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { clearPdfImports, deleteQuestion, getBookImage, getQuestions, getUserData, saveQuestion, saveQuestions, saveUserData } from './lib/db';
import { canonicalSubjectLabel, makeId, normalizePrompt, parseQuestionBackup, parseQuestionImport, subjectFor } from './lib/questions';
import { bookApprovalIssues, isBookQuestionEligible } from './lib/bookData';
import { BOOK_EXAM_ROUNDS, bookRoundKey, bookRoundLabel, selectBookRound, selectPracticePool, PRACTICE_BATCH_SIZE, practiceBatchCount, selectPracticeBatch, selectSubjectSet, SUBJECT_SET_ORDERS, type SubjectSetOrder } from './lib/bookSelection';
import { READING_SCALES, readReadingScale, saveReadingScale, type ReadingScale } from './lib/readingPrefs';
import { resolveCbtShortcut, shortcutTargetKind } from './lib/cbtShortcuts';
import { assignPracticeAnswer, checkPracticeAnswer, supportsPracticeFeedback } from './lib/practiceFeedback';
import { activateStudySession } from './lib/studySessions';
import { SERVICE_WORKER_ENABLED } from './lib/runtimeFlags';
import { STATS_PERIODS, attemptsInPeriod, subjectAccuracy, type StatsPeriod } from './lib/statsPeriod';
import { REVIEW_GRADUATION_STREAK, reviewQueue, type ReviewState } from './lib/reviewQueue';
import { ERROR_REPORT_FIELDS, ERROR_REPORT_NOTE_LIMIT, errorReportExport, errorReportFieldLabel, errorReportInputError, openReportFor, removeErrorReport, setErrorReportStatus, upsertErrorReport } from './lib/errorReports';
import { BookExamImage, BookStoredImage, bookExplanationText } from './BookImages';
import { ReadableQuestion } from './ReadableQuestion';
import { ExplanationText } from './ExplanationText';
import { needsSymbolReview, symbolHints } from './lib/symbolReview';
import { correctionLabel, proposeCorrection, wantsCandidateExamImage, type CorrectionFile, type CorrectionGroup } from './lib/corrections';
import type { ProposalNote } from './BookReviewEditor';
import { SymbolHintList, SymbolPalette } from './SymbolPalette';
import PhoneConnect from './PhoneConnect';
import { EMPTY_USER_DATA, SCHEME_INFO, SUBJECTS } from './constants';
import type { ActiveSession, Attempt, ErrorReport, ErrorReportField, Question, SchemeId, SessionMode, UserData } from './types';

type View = 'dashboard' | 'examSetup' | 'cbt' | 'result' | 'mistakes' | 'stats' | 'history' | 'bank' | 'corrections' | 'pdfImport' | 'bookImport' | 'phone' | 'transfer';
const PdfImporter = lazy(() => import('./PdfImporter'));
const BookImporter = lazy(() => import('./BookImporter'));
const DeviceTransfer = lazy(() => import('./DeviceTransfer'));
const OfflineSetup = lazy(() => import('./OfflineSetup'));
const BookReviewEditor = lazy(() => import('./BookReviewEditor'));
const CorrectionReview = lazy(() => import('./CorrectionReview'));

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v16H6.5A2.5 2.5 0 0 0 4 21.5z"/><path d="M4 5.5v16M8 7h8M8 11h8"/></>,
    chart: <><path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/></>,
    warning: <><path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4m0 4h.01"/></>,
    folder: <><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2m10-10h-2M4 12H2m17.1 7.1-1.4-1.4M6.3 6.3 4.9 4.9m14.2 0-1.4 1.4M6.3 17.7l-1.4 1.4"/></>,
    moon: <path d="M20.9 13A8.9 8.9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>,
    plus: <><path d="M12 5v14M5 12h14"/></>,
    upload: <><path d="M12 16V4m-4 4 4-4 4 4"/><path d="M4 16v4h16v-4"/></>,
    download: <><path d="M12 4v12m-4-4 4 4 4-4"/><path d="M4 18v2h16v-2"/></>,
    play: <path d="m8 5 11 7-11 7z"/>,
    check: <path d="m5 12 4 4L19 6"/>,
    arrow: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    left: <><path d="M19 12H5"/><path d="m11 18-6-6 6-6"/></>,
    right: <><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></>,
    flag: <><path d="M4 21V5m0 0c6-4 10 4 16 0v11c-6 4-10-4-16 0"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    phone: <><rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/></>,
    search: <><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></>,
    edit: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z"/></>,
    trash: <><path d="M4 7h16M10 11v6m4-6v6M6 7l1 14h10l1-14M9 7V4h6v3"/></>,
    bookmark: <path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4z"/>,
    shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Z"/><path d="m9 12 2 2 4-4"/></>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
    minus: <path d="M5 12h14"/>,
    shuffle: <><path d="m18 14 4 4-4 4"/><path d="M18 2l4 4-4 4"/><path d="M2 18h2.5c2.5 0 3.9-1.1 5.3-3l4.4-6c1.4-1.9 2.8-3 5.3-3H22M2 6h2.5c1.4 0 2.5.3 3.5 1"/><path d="M14 16c1.3 1.3 2.8 2 5.5 2H22"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.more}</svg>;
}

function formatClock(seconds: number): string {
  const safe = Math.max(0, seconds);
  return `${String(Math.floor(safe / 3600)).padStart(2, '0')}:${String(Math.floor((safe % 3600) / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export type { ReviewState } from './lib/reviewQueue';

/** Derive review state from submitted records without inventing or writing answers. */
export function latestReviewItems(attempts: Attempt[], questions: Question[]): { questionId: string; state: ReviewState }[] {
  return reviewQueue(attempts, questions).map(({ questionId, state }) => ({ questionId, state }));
}
export function latestWrongIds(attempts: Attempt[], questions: Question[]): string[] {
  return latestReviewItems(attempts, questions).filter((item) => item.state === 'wrong').map((item) => item.questionId);
}

export function scoreAttempt(attempt: Attempt, questions: Question[]) {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const subjects = SUBJECTS[attempt.scheme];
  const subjectScores = subjects.map((subject) => {
    const subjectQuestions = attempt.questionIds.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q && subjectFor(q, attempt.scheme) === subject));
    const correct = subjectQuestions.filter((question) => attempt.answers[question.id] === question.answer).length;
    const value = subjectQuestions.length ? correct / subjectQuestions.length * 100 : 0;
    return { subject, count: subjectQuestions.length, correct, value, score: Math.round(value) };
  }).filter((row) => row.count > 0);
  const answered = attempt.questionIds.map((id) => byId.get(id)).filter((q): q is Question => Boolean(q));
  const correct = answered.filter((question) => attempt.answers[question.id] === question.answer).length;
  const value = answered.length ? correct / answered.length * 100 : 0;
  const score = Math.round(value);
  const questionsPerSubject = SCHEME_INFO[attempt.scheme].count / SUBJECTS[attempt.scheme].length;
  const fullExam = attempt.feedbackEnabled !== true && attempt.mode !== 'book-round' && answered.every((question) => !question.book) && attempt.questionIds.length === SCHEME_INFO[attempt.scheme].count
    && subjectScores.length === SUBJECTS[attempt.scheme].length
    && subjectScores.every((row) => row.count === questionsPerSubject);
  const passed = fullExam && subjectScores.every((row) => row.value >= 40) && value >= 60;
  return { subjectScores, answered: Object.keys(attempt.answers).length, correct, total: attempt.questionIds.length, score, fullExam, passed };
}

function exportFile(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [user, setUser] = useState<UserData>(EMPTY_USER_DATA);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('dashboard');
  const [scheme, setScheme] = useState<SchemeId>('legacy');
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [result, setResult] = useState<Attempt | null>(null);
  const [showEditor, setShowEditor] = useState<Question | 'new' | null>(null);
  const [search, setSearch] = useState('');
  const [bankFilter, setBankFilter] = useState<'all' | 'verified' | 'pending'>('all');
  const [bankSubjectFilter, setBankSubjectFilter] = useState('all');
  const [bankSymbolOnly, setBankSymbolOnly] = useState(false);
  const [bankAiOnly, setBankAiOnly] = useState(false);
  const [correctionFile, setCorrectionFile] = useState<CorrectionFile | null>(null);
  const [proposal, setProposal] = useState<{ question: Question; notes: ProposalNote[]; useCandidate: boolean } | null>(null);
  // A proposal lives only while its editor is open; it never re-applies on a later open.
  useEffect(() => { if (!showEditor) setProposal(null); }, [showEditor]);
  const [setupMode, setSetupMode] = useState<SessionMode>('random');
  const [setupSubject, setSetupSubject] = useState(SUBJECTS.legacy[0]);
  const [setupBatch, setSetupBatch] = useState(0);
  const [setupOrder, setSetupOrder] = useState<SubjectSetOrder>('random');
  const [readingScale, setReadingScale] = useState<ReadingScale>(readReadingScale);
  const [setupYear, setSetupYear] = useState('all');
  const [setupRound, setSetupRound] = useState('');
  const [setupBookRound, setSetupBookRound] = useState('2025:1');
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState('');
  const [exitConfirm, setExitConfirm] = useState(false);
  const [reportTarget, setReportTarget] = useState<{ question: Question; context: ErrorReport['context'] } | null>(null);

  useEffect(() => {
    Promise.all([getQuestions(), getUserData()]).then(([bank, saved]) => {
      setQuestions(bank);
      setUser(saved);
      if (saved.activeSession) {
        const remaining = Math.ceil((saved.activeSession.deadlineAt - Date.now()) / 1000);
        if (remaining > 0) {
          setSession(saved.activeSession);
          setView('cbt');
        } else {
          const timedOut: Attempt = {
            id: saved.activeSession.id,
            title: saved.activeSession.title,
            scheme: saved.activeSession.scheme,
            mode: saved.activeSession.mode,
            questionIds: saved.activeSession.questionIds,
            answers: saved.activeSession.answers,
            startedAt: saved.activeSession.startedAt,
            submittedAt: new Date().toISOString(),
            remainingSeconds: 0,
            feedbackEnabled: supportsPracticeFeedback(saved.activeSession), checkedQuestionIds: saved.activeSession.checkedQuestionIds,
          };
          const updated = { ...saved, activeSession: undefined, attempts: [timedOut, ...saved.attempts] };
          setUser(updated);
          void saveUserData(updated);
        }
      }
    }).catch((error) => setNotice(`저장소를 열지 못했습니다: ${String(error)}`)).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = user.theme;
  }, [user.theme]);

  useEffect(() => {
    document.documentElement.dataset.readingScale = readingScale;
  }, [readingScale]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session || Math.ceil((session.deadlineAt - now) / 1000) > 0) return;
    void submitSession();
  }, [now, session]);

  const verifiedQuestions = useMemo(() => questions.filter((question) => isBookQuestionEligible(question, questions)), [questions]);
  const eligibleQuestionIds = useMemo(() => new Set(verifiedQuestions.map((question) => question.id)), [verifiedQuestions]);
  const pendingCount = questions.length - verifiedQuestions.length;
  const aiReviewCount = useMemo(() => questions.filter((question) => question.book?.review?.ai).length, [questions]);
  const symbolReviewIds = useMemo(() => new Set(questions.filter(needsSymbolReview).map((question) => question.id)), [questions]);
  const reviewItems = useMemo(() => reviewQueue(user.attempts, questions), [user.attempts, questions]);
  const reviewStreaks = useMemo(() => new Map(reviewItems.map((item) => [item.questionId, item.correctStreak])), [reviewItems]);
  const reviewIds = useMemo(() => reviewItems.map((item) => item.questionId), [reviewItems]);
  const reviewStates = useMemo(() => new Map(reviewItems.map((item) => [item.questionId, item.state])), [reviewItems]);
  const setupPool = useMemo(() => setupMode === 'book-round' ? selectBookRound(questions, setupBookRound) : selectPracticePool(questions, {
    scheme, mode: setupMode, subject: setupSubject, year: setupYear, round: setupRound, wrongIds: reviewIds, bookmarkedIds: user.bookmarks,
  }), [questions, scheme, setupMode, setupSubject, setupYear, setupRound, setupBookRound, reviewIds, user.bookmarks]);
  useEffect(() => { setSetupBatch(0); }, [scheme, setupMode, setupSubject, setupYear, setupRound, setupBookRound]);
  const setupBatchQuestions = useMemo(() => selectPracticeBatch(setupPool, setupBatch), [setupPool, setupBatch]);
  const subjectSetMode = setupMode === 'subject' && setupOrder !== 'book';
  const subjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    if (setupMode !== 'subject') return counts;
    for (const question of selectPracticePool(questions, { scheme, mode: 'random' })) {
      const subject = subjectFor(question, scheme);
      if (subject) counts.set(subject, (counts.get(subject) ?? 0) + 1);
    }
    return counts;
  }, [questions, scheme, setupMode]);
  const recentAttempt = user.attempts[0];
  const stats = useMemo(() => {
    const answeredIds = new Set<string>();
    let answered = 0;
    let correct = 0;
    for (const attempt of user.attempts) {
      for (const [id, answer] of Object.entries(attempt.answers)) {
        if (answeredIds.has(`${attempt.id}:${id}`)) continue;
        answeredIds.add(`${attempt.id}:${id}`);
        const question = questions.find((item) => item.id === id);
        if (question) {
          answered++;
          if (answer === question.answer) correct++;
        }
      }
    }
    return { answered, correct, accuracy: answered ? Math.round(correct / answered * 100) : 0 };
  }, [user.attempts, questions]);

  async function persistUser(next: UserData) {
    setUser(next);
    await saveUserData(next);
  }

  function go(next: View) {
    if (next !== 'cbt' && session) return;
    setView(next);
  }

  function changeReadingScale(scale: ReadingScale) {
    setReadingScale(scale);
    saveReadingScale(scale);
  }

  function toggleTheme() {
    void persistUser({ ...user, theme: user.theme === 'light' ? 'dark' : 'light' });
  }

  function toggleBookmark(questionId: string) {
    const bookmarks = user.bookmarks.includes(questionId) ? user.bookmarks.filter((id) => id !== questionId) : [...user.bookmarks, questionId];
    void persistUser({ ...user, bookmarks });
  }

  async function saveErrorReport(target: { question: Question; context: ErrorReport['context'] }, fields: ErrorReportField[], note: string) {
    const errorReports = upsertErrorReport(user.errorReports, target.question, { fields, note }, target.context, new Date().toISOString(), makeId);
    await persistUser({ ...user, errorReports });
    setReportTarget(null);
    setNotice('오류 신고를 저장했습니다. 문제은행 화면에서 모아 보고 내보낼 수 있습니다.');
  }

  function changeErrorReportStatus(id: string, status: ErrorReport['status']) {
    void persistUser({ ...user, errorReports: setErrorReportStatus(user.errorReports, id, status, new Date().toISOString()) });
  }

  function deleteErrorReport(id: string) {
    if (!window.confirm('이 오류 신고를 삭제할까요? 삭제한 신고는 되돌릴 수 없습니다.')) return;
    void persistUser({ ...user, errorReports: removeErrorReport(user.errorReports, id) });
  }

  async function beginSession(questionList: Question[], selectedScheme: SchemeId, mode: SessionMode, title: string, minutes: number, feedbackEnabled = true) {
    for (const question of questionList) {
      if (!question.book) continue;
      const review = await getBookImage(question.book.reviewImageId);
      const exam = question.book.examImageId ? await getBookImage(question.book.examImageId) : undefined;
      if (!isBookQuestionEligible(question, questions) || !review || review.kind !== 'review' || !review.blob.size || (question.book.examImageId && (!exam || exam.kind !== 'exam' || !exam.blob.size))) {
        setNotice('검수 상태 또는 교재 이미지 연결을 확인해 주세요. 이 문항으로 시험을 시작할 수 없습니다.'); return;
      }
    }
    const active: ActiveSession = {
      id: makeId(), title, scheme: selectedScheme, mode,
      questionIds: questionList.map((question) => question.id), answers: {}, markedIds: [], index: 0,
      startedAt: new Date().toISOString(), deadlineAt: Date.now() + minutes * 60_000,
      feedbackEnabled, checkedQuestionIds: [],
    };
    setSession(active);
    await persistUser(activateStudySession(user, active, Date.now()));
    setView('cbt');
  }

  function startPractice(mode: SessionMode, official = false) {
    if (mode === 'book-round') {
      const round = BOOK_EXAM_ROUNDS.find((item) => bookRoundKey(item) === setupBookRound)!;
      const pool = selectPracticeBatch(selectBookRound(questions, setupBookRound), setupBatch);
      if (pool.length === 0) {
        setNotice(`${bookRoundLabel(round)}는 책의 ${round.count}문항 중 ${pool.length}문항이 검수 완료되었습니다. 자동 검사 또는 원본 대조 검수 후 시작할 수 있습니다. 결번은 채우지 않습니다.`);
        return;
      }
      void beginSession(pool, 'legacy', 'book-round', `${bookRoundLabel(round)} · ${setupBatch + 1}묶음 · ${pool.length}문항`, Math.max(10, pool.length * 1.5));
      return;
    }
    let pool = selectPracticePool(questions, { scheme, mode, official, subject: setupSubject, year: setupYear, round: setupRound, wrongIds: reviewIds, bookmarkedIds: user.bookmarks });
    let title = '랜덤 모의풀이';
    if (mode === 'subject') {
      title = `${setupSubject} 연습`;
    } else if (mode === 'round') {
      title = `${setupYear === 'all' ? scheme === 'legacy' ? '2024–2026' : '2027–2029' : setupYear} 기출 회차`;
    } else if (mode === 'wrong') {
      title = '오답·미응답 복습';
    } else if (mode === 'bookmarked') {
      title = '북마크 문제 풀기';
    }
    if (official) {
      const perSubject = SCHEME_INFO[scheme].count / SUBJECTS[scheme].length;
      const chosen: Question[] = [];
      for (const subject of SUBJECTS[scheme]) {
        const subjectPool = shuffle(pool.filter((question) => subjectFor(question, scheme) === subject));
        if (subjectPool.length < perSubject) {
          setNotice(`${subject} 검수 완료 문제가 ${subjectPool.length}개입니다. 정식 모의고사에는 과목별 ${perSubject}문제가 필요합니다.`);
          return;
        }
        chosen.push(...subjectPool.slice(0, perSubject));
      }
      void beginSession(shuffle(chosen), scheme, mode, '전체 무작위 정식 모의고사', SCHEME_INFO[scheme].minutes, false);
      return;
    }
    if (mode === 'subject' && setupOrder !== 'book') {
      const subjectSet = selectSubjectSet(pool, setupOrder, { attempts: user.attempts, reviewStates });
      if (subjectSet.length === 0) {
        setNotice('선택한 과목에 출제 가능한 검수 완료 문제가 없습니다. 문제은행의 검수 상태를 확인해 주세요.');
        return;
      }
      const orderLabel = SUBJECT_SET_ORDERS.find((order) => order.id === setupOrder)?.label ?? '';
      void beginSession(subjectSet, scheme, mode, `${setupSubject} · ${orderLabel} ${subjectSet.length}문항`, Math.max(10, subjectSet.length));
      return;
    }
    if (mode === 'random') {
      pool = shuffle(pool).slice(0, PRACTICE_BATCH_SIZE);
      title = `전체 무작위 ${pool.length}문제`;
    } else {
      pool = selectPracticeBatch(pool, setupBatch);
      title = `${title} · ${setupBatch + 1}묶음 · ${pool.length}문항`;
    }
    if (pool.length === 0) {
      setNotice(mode === 'wrong' ? '복습할 오답·미응답이 없습니다.' : mode === 'bookmarked' ? '북마크한 문제가 없습니다.' : questions.length === 0 ? '현재 브라우저에 등록된 문제가 없습니다. 교재 ZIP을 가져온 뒤 시작해 주세요.' : '선택한 범위에 출제 가능한 문제가 없습니다. 과목·출제 기준과 문제은행의 검수 상태를 확인해 주세요.');
      return;
    }
    void beginSession(pool, scheme, mode, title, Math.max(10, pool.length * (mode === 'subject' ? 1 : 1.5)));
  }

  async function submitSession() {
    if (!session) return;
    const attempt: Attempt = {
      id: session.id,
      title: session.title,
      scheme: session.scheme,
      mode: session.mode,
      questionIds: session.questionIds,
      answers: session.answers,
      startedAt: session.startedAt,
      submittedAt: new Date().toISOString(),
      remainingSeconds: Math.max(0, Math.ceil((session.deadlineAt - Date.now()) / 1000)),
      feedbackEnabled: supportsPracticeFeedback(session), checkedQuestionIds: session.checkedQuestionIds,
    };
    const updated = { ...user, activeSession: undefined, attempts: [attempt, ...user.attempts] };
    setSession(null);
    setResult(attempt);
    setView('result');
    await persistUser(updated);
  }

  function requestSubmit() {
    if (!session) return;
    const unanswered = session.questionIds.length - Object.keys(session.answers).length;
    const message = unanswered ? `아직 답하지 않은 문제가 ${unanswered}개 있습니다. 시험을 제출할까요?` : '답안을 제출하고 채점할까요?';
    if (window.confirm(message)) void submitSession();
  }

  async function saveActiveSession(next: ActiveSession) {
    setSession(next);
    await persistUser({ ...user, activeSession: next });
  }

  async function importQuestionFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const parsed = parseQuestionImport(JSON.parse(await file.text()));
      const existing = [...questions];
      const incoming: Question[] = parsed.map((question) => {
        const normalized = normalizePrompt(question.prompt);
        const duplicate = existing.find((item) => normalizePrompt(item.prompt) === normalized);
        const created: Question = { ...question, id: makeId(), status: 'pending', createdAt: new Date().toISOString(), ...(duplicate ? { duplicateOf: duplicate.id } : {}) };
        existing.push(created);
        return created;
      });
      await saveQuestions(incoming);
      setQuestions(existing);
      setNotice(`${incoming.length}개 문항을 검수 대기 상태로 가져왔습니다. 중복 의심 ${incoming.filter((q) => q.duplicateOf).length}개.`);
      window.setTimeout(() => setNotice(''), 5000);
    } catch (error) {
      window.alert(`가져오지 못했습니다. ${String(error)}`);
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.version !== 1 || !Array.isArray(data.questionBank) || !data.userData || !Array.isArray(data.userData.attempts)) throw new Error('지원하지 않는 백업 형식입니다.');
      if (!window.confirm(`문제은행 ${data.questionBank.length}개와 학습기록을 백업 파일 내용으로 복원할까요? 현재 데이터는 교체됩니다.`)) return;
      const restored = parseQuestionBackup(data.questionBank);
      let missingBookImages = 0;
      for (const question of restored) {
        if (!question.book || question.status !== 'verified') continue;
        const review = await getBookImage(question.book.reviewImageId);
        const exam = question.book.examImageId ? await getBookImage(question.book.examImageId) : undefined;
        if (!review || review.kind !== 'review' || (question.book.examImageId && (!exam || exam.kind !== 'exam'))) {
          question.status = 'pending'; missingBookImages++;
        }
      }
      const existingQuestions = await getQuestions();
      await Promise.all(existingQuestions.map((question) => deleteQuestion(question.id)));
      await saveQuestions(restored);
      const restoredUser: UserData = { ...EMPTY_USER_DATA, ...data.userData, key: 'state' };
      await persistUser(restoredUser);
      setQuestions(restored);
      window.alert(`백업을 복원했습니다. 진행 중이던 세션도 포함했습니다.${missingBookImages ? ` 교재 이미지가 없는 ${missingBookImages}문항은 검수 대기로 복원했습니다. 이미지 Blob은 JSON에 포함되지 않으므로 원본 ZIP을 다시 가져와 주세요.` : ''}`);
    } catch (error) {
      window.alert(`백업 복원 실패: ${String(error)}`);
    }
  }

  async function removeQuestion(question: Question) {
    if (!window.confirm('이 문제를 문제은행에서 삭제할까요?')) return;
    await deleteQuestion(question.id);
    setQuestions((current) => current.filter((item) => item.id !== question.id));
    await persistUser({ ...user, bookmarks: user.bookmarks.filter((id) => id !== question.id) });
  }

  async function resetLocalData() {
    const confirmed = window.confirm('문제은행, 응시 이력, 북마크를 모두 삭제합니다. 복구할 수 없으니 필요한 데이터는 먼저 전체 데이터 백업으로 내보내 주세요. 계속할까요?');
    if (!confirmed) return;
    await Promise.all(questions.map((question) => deleteQuestion(question.id)));
    await clearPdfImports();
    await persistUser(EMPTY_USER_DATA);
    setQuestions([]);
    setSession(null);
    setResult(null);
    setView('dashboard');
    setNotice('이 기기의 문제은행과 학습 기록을 초기화했습니다.');
    window.setTimeout(() => setNotice(''), 5000);
  }

  async function saveEditedQuestion(question: Question) {
    const duplicate = questions.find((item) => item.id !== question.id && normalizePrompt(item.prompt) === normalizePrompt(question.prompt));
    const next = { ...question, status: 'pending' as const, duplicateOf: duplicate?.id, createdAt: question.createdAt || new Date().toISOString() };
    if (!duplicate) delete next.duplicateOf;
    await saveQuestion(next);
    // Same ID, same list position: attempts, bookmarks and sessions keep pointing at this question.
    setQuestions((items) => items.some((item) => item.id === next.id) ? items.map((item) => item.id === next.id ? next : item) : [next, ...items]);
    setShowEditor(null);
    setNotice(duplicate ? '문항을 저장했습니다. 유사한 문제를 찾아 검수 대기에 표시했습니다.' : '문항을 검수 대기 상태로 저장했습니다.');
    window.setTimeout(() => setNotice(''), 5000);
  }

  function openCorrection(group: CorrectionGroup) {
    if (!group.question) return;
    try {
      const proposed = proposeCorrection(group);
      const notes = group.items.filter((entry) => entry.state === 'ready').map(({ item }) => ({ label: correctionLabel(item), before: item.field === 'answer' ? `${item.before ?? '없음'}번` : item.field === 'examImage' ? '없음' : String(item.before), after: item.field === 'answer' ? `${item.after}번` : item.field === 'examImage' ? 'ZIP 문제용 이미지 연결(정답 미노출 확인 필요)' : String(item.after), note: item.note }));
      if (group.question.book) { setProposal({ question: proposed, notes, useCandidate: wantsCandidateExamImage(group) }); setShowEditor(group.question); }
      // Non-book questions use the plain editor, which always saves as pending.
      else setShowEditor(proposed);
    } catch (reason) { setNotice(reason instanceof Error ? reason.message : String(reason)); }
  }

  async function verifyQuestion(question: Question) {
    if (question.book) { setShowEditor(question); return; }
    if (!isBookQuestionEligible({ ...question, status: 'verified' }) || !SUBJECTS.legacy.includes(subjectFor(question, 'legacy') ?? '') || !question.explanation.trim()) {
      setNotice('지문·보기 4개·정답 번호·과목·해설을 확인한 뒤 승인해 주세요.'); setShowEditor(question); return;
    }
    if (question.duplicateOf && !window.confirm('중복 의심 문제입니다. 문항과 답을 확인했고 별도 문제로 등록할까요?')) return;
    const verified = { ...question, status: 'verified' as const };
    await saveQuestion(verified);
    setQuestions((items) => items.map((item) => item.id === question.id ? verified : item));
  }

  async function approveBookQuestion(question: Question) {
    question = { ...question, book: { ...question.book!, review: { ...question.book!.review, automatic: undefined, ai: undefined } } };
    const issues = bookApprovalIssues(question, questions.map((item) => item.id === question.id ? question : item));
    if (issues.length) throw new Error(issues.join(' / '));
    const review = await getBookImage(question.book!.reviewImageId);
    if (!review || review.kind !== 'review' || !review.blob.size) throw new Error('검수용 원본 JPG가 없습니다.');
    if (question.book!.examImageId) {
      const exam = await getBookImage(question.book!.examImageId);
      if (!exam || exam.kind !== 'exam' || !exam.blob.size || !question.book!.review.examImageSafe) throw new Error('정답 미노출을 확인한 별도 시험용 이미지가 필요합니다.');
    }
    const verified = { ...question, status: 'verified' as const };
    await saveQuestion(verified);
    setQuestions((items) => items.map((item) => item.id === question.id ? verified : item));
    setShowEditor(null);
    setNotice('원본 대조를 마친 교재 문항을 승인했습니다.');
  }

  function toggleMarked(id: string) {
    if (!session) return;
    const markedIds = session.markedIds.includes(id) ? session.markedIds.filter((item) => item !== id) : [...session.markedIds, id];
    void saveActiveSession({ ...session, markedIds });
  }

  function answerQuestion(questionId: string, answer: number) {
    if (!session) return;
    const updated = assignPracticeAnswer(session, questionId, answer);
    if (updated !== session) void saveActiveSession(updated);
  }

  function checkCurrentAnswer() {
    if (!session || !currentQuestion || !isBookQuestionEligible(currentQuestion, questions)) return;
    const updated = checkPracticeAnswer(session, currentQuestion);
    if (updated !== session) void saveActiveSession(updated);
  }

  async function resumeSavedSession(saved: ActiveSession) {
    const updated = activateStudySession(user, saved, Date.now());
    await persistUser(updated);
    setSession(updated.activeSession!); setView('cbt');
  }

  function moveToQuestion(index: number) {
    if (!session) return;
    void saveActiveSession({ ...session, index: Math.max(0, Math.min(session.questionIds.length - 1, index)) });
  }

  async function openResume() {
    if (!user.activeSession) return;
    setSession(user.activeSession);
    setView('cbt');
  }

  if (loading) return <div className="loading-screen"><div className="brand-mark"><Icon name="shield" size={25} /></div><p>학습 데이터를 불러오는 중...</p></div>;

  const reviewQuestions = questions.filter((question) => reviewStates.has(question.id));
  const bookmarkedQuestions = questions.filter((question) => user.bookmarks.includes(question.id));
  const bankRows = questions.filter((question) => (!bankSymbolOnly || symbolReviewIds.has(question.id)) && (!bankAiOnly || Boolean(question.book?.review?.ai)) && (bankFilter === 'all' || (bankFilter === 'verified' ? eligibleQuestionIds.has(question.id) : !eligibleQuestionIds.has(question.id))) && (bankSubjectFilter === 'all' || subjectFor(question, 'legacy') === bankSubjectFilter) && `${question.prompt} ${subjectFor(question, 'legacy')} ${question.book?.originalId ?? ''} ${question.year ?? ''} ${question.round}`.toLowerCase().includes(search.toLowerCase()));
  const currentQuestion = session ? questions.find((question) => question.id === session.questionIds[session.index]) : undefined;
  const remaining = session ? Math.max(0, Math.ceil((session.deadlineAt - now) / 1000)) : 0;
  const years = [...new Set(verifiedQuestions.filter((question) => !question.book).map((question) => question.year).filter((year): year is number => year !== null))].sort((a, b) => b - a);
  const rounds = [...new Set(verifiedQuestions.filter((question) => !question.book && question.round.trim() && (setupYear === 'all' || question.year === Number(setupYear))).map((question) => question.round))].sort((a, b) => a.localeCompare(b, 'ko'));

  return <div className={`app-shell ${view === 'cbt' ? 'exam-shell' : ''}`}>
    {view !== 'cbt' && <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><Icon name="shield" size={22} /></div><div><strong>안전한 합격</strong><span>산업안전기사 CBT</span></div></div>
      <div className="nav-caption">학습</div>
      <nav className="main-nav" aria-label="주 메뉴">
        <NavItem active={view === 'dashboard'} icon="home" label="대시보드" onClick={() => go('dashboard')} />
        <NavItem active={view === 'examSetup'} icon="book" label="모의시험" onClick={() => go('examSetup')} badge={user.activeSession ? '진행 중' : undefined} />
        <NavItem active={view === 'mistakes'} icon="warning" label="오답노트" onClick={() => go('mistakes')} count={reviewQuestions.length} />
        <NavItem active={view === 'stats' || view === 'history'} icon="chart" label="학습 통계" onClick={() => go('stats')} />
      </nav>
      <div className="nav-caption bank-caption">관리</div>
      <nav className="main-nav"><NavItem active={view === 'bank' || view === 'corrections'} icon="folder" label="문제은행" onClick={() => go('bank')} count={pendingCount || undefined} /><NavItem active={view === 'pdfImport'} icon="upload" label="PDF 가져오기" onClick={() => go('pdfImport')} /><NavItem active={view === 'bookImport'} icon="book" label="교재 ZIP" onClick={() => go('bookImport')} /><NavItem active={view === 'phone'} icon="phone" label="휴대폰 연결" onClick={() => go('phone')}/><NavItem active={view === 'transfer'} icon="download" label="기기 이전·백업" onClick={() => go('transfer')}/></nav>
      <div className="sidebar-bottom">
        <div className="offline-tag"><span className="online-dot"/><div><strong>오프라인 학습</strong><small>기기에 안전하게 저장</small></div></div>
        <button className="theme-button" onClick={toggleTheme}><span className="theme-icon"><Icon name={user.theme === 'light' ? 'moon' : 'sun'} /></span><span>{user.theme === 'light' ? '다크 모드' : '라이트 모드'}</span><span className={`switch ${user.theme === 'dark' ? 'on' : ''}`} /></button>
        <div className="profile"><div className="avatar">나</div><div><strong>나의 학습공간</strong><small>개인 학습자</small></div><Icon name="more" size={17}/></div>
      </div>
    </aside>}

    <main className={`main-area ${view === 'cbt' ? 'cbt-main' : ''}`}>
      {view !== 'cbt' && <header className="topbar"><div className="mobile-brand"><div className="brand-mark"><Icon name="shield" size={18} /></div><strong>안전한 합격</strong></div><div className="breadcrumb">산업안전기사 <span>/</span> {viewTitle(view)}</div><div className="topbar-right"><div className="save-state"><span className="online-dot"/> 자동 저장됨</div><button className="icon-button top-theme" aria-label="테마 변경" onClick={toggleTheme}><Icon name={user.theme === 'light' ? 'moon' : 'sun'} /></button></div></header>}
      {notice && <div className="notice"><Icon name="check" size={16}/>{notice}<button onClick={() => setNotice('')} aria-label="닫기"><Icon name="close" size={14}/></button></div>}
      {view === 'dashboard' && SERVICE_WORKER_ENABLED && <div className="page-content"><Suspense fallback={<p>모바일 앱 준비 상태를 확인하는 중...</p>}><OfflineSetup onTransfer={() => go('transfer')}/></Suspense></div>}
      {view === 'dashboard' && <Dashboard
        questionCount={verifiedQuestions.length} pendingCount={pendingCount} stats={stats} wrongCount={reviewQuestions.length}
        questions={questions} attempts={user.attempts}
        bookmarks={bookmarkedQuestions.length} recentAttempt={recentAttempt} scheme={scheme} setScheme={setScheme}
        onExam={() => go('examSetup')} onBank={() => go('bank')} onMistakes={() => go('mistakes')}
        onSubjectStart={(subject) => { setSetupMode('subject'); if (subject) setSetupSubject(subject); go('examSetup'); }}
        onOfficialStart={() => { go('examSetup'); window.setTimeout(() => { const target = document.querySelector<HTMLButtonElement>('.official-card .white-button'); target?.scrollIntoView({ block: 'center' }); target?.focus({ preventScroll: true }); }, 50); }}
        onResume={openResume} activeSession={user.activeSession} onHistory={() => go('history')}
      />}
      {view === 'dashboard' && Boolean(user.savedSessions?.length) && <section className="page-content saved-study"><div className="panel"><h2>저장한 학습</h2><p>새 묶음을 시작하기 전에 풀던 문제와 답안을 보관했습니다.</p>{user.savedSessions!.map((saved) => <div className="saved-study-row" key={saved.id}><div><strong>{saved.title}</strong><small>응답 {Object.keys(saved.answers).length} / {saved.questionIds.length}문항</small></div><button className="button outline" onClick={() => void resumeSavedSession(saved)}>이어서 풀기</button></div>)}</div></section>}
      {view === 'phone' && <PhoneConnect onImport={() => setView('bookImport')}/>}
      {view === 'examSetup' && <section className="page-content setup-page">
        <PageHeading eyebrow="CBT 학습" title="20문항씩 차근차근 풀어보세요" description="문제마다 답을 선택한 뒤 정답과 해설을 바로 확인할 수 있습니다. 학습 내용은 이 기기에 저장됩니다." />
        {questions.length === 0 && <div className="book-callout"><strong>현재 브라우저에 등록된 문제가 없습니다.</strong><p>학습 데이터는 브라우저와 사이트 주소별로 저장됩니다. Safari, Chrome, Codex 브라우저에서 각각 교재를 가져와야 합니다.</p><button className="button outline" onClick={() => setView('bookImport')}>교재 ZIP 가져오기</button></div>}
        <div className="setup-layout">
          <div className="setup-main">
            <div className="setup-card"><div className="setup-card-heading"><div><span className="step-index">01</span><h2>출제 기준 선택</h2></div><p>응시할 연도의 과목 체계를 선택하세요.</p></div>
              <div className="scheme-options">
                {(['legacy', 'revised'] as SchemeId[]).map((id) => <button className={`scheme-option ${scheme === id ? 'selected' : ''}`} key={id} onClick={() => { setScheme(id); setSetupSubject(SUBJECTS[id][0]); }}><span className="radio-dot"/><span className="scheme-name">{SCHEME_INFO[id].label}</span><span className="scheme-meta">{SCHEME_INFO[id].count}문항 · {SCHEME_INFO[id].minutes / 60}시간</span></button>)}
              </div>
            </div>
            <div className="setup-card"><div className="setup-card-heading"><div><span className="step-index">02</span><h2>학습 방식 선택</h2></div><p>전체 랜덤, 과목별, 기출 회차, 오답, 북마크 중 선택하세요.</p></div>
              <div className="mode-grid">
                {([
                  ['random', '랜덤 모의풀이', '문제은행에서 20문항 무작위 출제', 'book'],
                  ['subject', '과목별 연습', '과목 선택 → 20문항 세트 (무작위·미풀이·오답 우선)', 'chart'],
                  ['book-round', '책 실전 회차', '2025 · 2024 · 2022년 책의 원래 순서로', 'folder'],
                  ['round', '기출 회차', '연도와 회차를 지정해 풀기', 'clock'],
                  ['wrong', '오답·미응답 복습', '최근 제출한 오답과 미응답을 다시 학습', 'warning'],
                  ['bookmarked', '북마크 문제', '저장해둔 문제를 모아 풀기', 'bookmark'],
                ] as [SessionMode, string, string, string][]).map(([id, title, desc, icon]) => <button key={id} className={`mode-card ${setupMode === id ? 'selected' : ''}`} onClick={() => setSetupMode(id)}><span className="mode-icon"><Icon name={icon}/></span><span className="mode-copy"><strong>{title}</strong><small>{desc}</small></span><span className="radio-dot"/></button>)}
              </div>
              {setupMode === 'subject' && <div className="subject-set-settings"><fieldset className="subject-set-group"><legend>과목 선택</legend><div className="subject-set-options">{SUBJECTS[scheme].map((subject, index) => <button type="button" key={subject} className={`subject-set-option ${setupSubject === subject ? 'selected' : ''}`} aria-pressed={setupSubject === subject} onClick={() => setSetupSubject(subject)}><span className="subject-set-no">{index + 1}과목</span><strong>{subject}</strong><small>출제 가능 {(subjectCounts.get(subject) ?? 0).toLocaleString()}문항</small></button>)}</div></fieldset><fieldset className="subject-set-group"><legend>출제 방식</legend><div className="subject-order-options">{SUBJECT_SET_ORDERS.map((order) => <button type="button" key={order.id} className={`subject-order-option ${setupOrder === order.id ? 'selected' : ''}`} aria-pressed={setupOrder === order.id} onClick={() => setSetupOrder(order.id)}><strong>{order.label}</strong><small>{order.description}</small></button>)}</div></fieldset></div>}
              {setupMode === 'round' && <div className="inline-settings"><label>연도<select value={setupYear} onChange={(event) => { setSetupYear(event.target.value); setSetupRound(''); }}><option value="all">전체 연도</option>{years.filter((year) => scheme === 'legacy' ? year >= 2024 && year <= 2026 : year >= 2027 && year <= 2029).map((year) => <option key={year}>{year}</option>)}</select></label><label>회차<select value={setupRound} onChange={(event) => setSetupRound(event.target.value)}><option value="">전체 회차</option>{rounds.map((round) => <option key={round}>{round}</option>)}</select></label></div>}
              {setupMode === 'book-round' && <div className="inline-settings book-round-settings"><label>책 실전 회차<select value={setupBookRound} onChange={(event) => setSetupBookRound(event.target.value)}>{BOOK_EXAM_ROUNDS.map((round) => <option key={round.round} value={bookRoundKey(round)}>{bookRoundLabel(round)} · {round.count}문항</option>)}</select></label><div className="setup-note">승인된 문항을 책의 원래 순서대로 20문항씩 나눕니다. 원래 번호와 결번을 보존합니다.</div></div>}
              {setupMode !== 'random' && !subjectSetMode && practiceBatchCount(setupPool) > 0 && <div className="inline-settings"><label>20문항 학습 묶음<select value={setupBatch} onChange={(event) => setSetupBatch(Number(event.target.value))}>{Array.from({ length: practiceBatchCount(setupPool) }, (_, index) => <option key={index} value={index}>{index + 1}묶음 · 학습 순서 {index * PRACTICE_BATCH_SIZE + 1}–{Math.min((index + 1) * PRACTICE_BATCH_SIZE, setupPool.length)}</option>)}</select></label><div className="setup-note">마지막 묶음은 남은 문항만 출제합니다. 마지막 문제의 ‘학습 완료’로 결과를 저장할 수 있습니다.</div></div>}
              {setupMode === 'random' && <div className="setup-note">매번 20문항을 무작위로 선택합니다. 문항이 적으면 등록된 수만큼 출제합니다.</div>}
            </div>
            <p className="setup-note" role="status">{subjectSetMode ? <>검수 완료 {setupPool.length.toLocaleString()}문항 · 이번 세트 {Math.min(PRACTICE_BATCH_SIZE, setupPool.length)}문항{setupPool.length > 0 && setupPool.length < PRACTICE_BATCH_SIZE && <strong className="short-set-note"> (20문항 미만 · 결번은 채우지 않습니다)</strong>} · 정답·해설 즉시 확인</> : <>출제 가능 {setupPool.length.toLocaleString()}문항 · 이번 학습 {setupMode === 'random' ? Math.min(PRACTICE_BATCH_SIZE, setupPool.length) : setupBatchQuestions.length}문항 · 정답·해설 즉시 확인</>}</p>
            <button className="button primary large start-practice" disabled={setupPool.length === 0} onClick={() => startPractice(setupMode)}><Icon name="play" size={17}/>연습 시작<Icon name="arrow" size={17}/></button>
          </div>
          <aside className="setup-aside">
            <div className="official-card"><span className="official-label"><Icon name="shield" size={15}/> 정식 분량</span><h3>실전 모의고사</h3><p>시험 기준에 맞춘 과목별 균등 출제로 실전처럼 풀어보세요.</p><div className="official-metrics"><span><strong>{SCHEME_INFO[scheme].count}</strong>문항</span><span><strong>{SCHEME_INFO[scheme].minutes}</strong>분</span><span><strong>{SUBJECTS[scheme].length}</strong>과목</span></div><button className="button white-button" onClick={() => startPractice('random', true)}>정식 시험 시작 <Icon name="arrow" size={16}/></button><small className="official-footnote">과목별 검수 완료 문제 {SCHEME_INFO[scheme].count / SUBJECTS[scheme].length}개씩 필요</small></div>
            <div className="side-info-card"><div className="side-info-icon"><Icon name="shield"/></div><div><strong>채점 기준</strong><p>과목마다 40점 이상, 전 과목 평균 60점 이상이면 합격입니다.</p></div></div>
            <div className="side-info-card"><div className="side-info-icon mint"><Icon name="clock"/></div><div><strong>자동 저장</strong><p>진행 중인 시험은 답안과 남은 시간이 저장되어 이어풀 수 있습니다.</p></div></div>
          </aside>
        </div>
      </section>}
      {view === 'cbt' && session && currentQuestion && isBookQuestionEligible(currentQuestion, questions) && <CBTScreen
        question={currentQuestion} session={session} questions={questions} remaining={remaining} user={user}
        onAnswer={(answer) => answerQuestion(currentQuestion.id, answer)} onCheck={checkCurrentAnswer} onNavigate={moveToQuestion}
        onBookmark={() => toggleBookmark(currentQuestion.id)} onMarked={() => toggleMarked(currentQuestion.id)} onSubmit={requestSubmit}
        onReport={() => setReportTarget({ question: currentQuestion, context: supportsPracticeFeedback(session) ? 'practice' : 'exam' })}
        readingScale={readingScale} onReadingScale={changeReadingScale} onEdit={() => setShowEditor(currentQuestion)}
        onExit={() => setExitConfirm(true)}
      />}
      {view === 'cbt' && session && !currentQuestion && <div className="page-content"><p>현재 문제은행에 세션의 문항이 없습니다. 기존 답안과 응시 기록은 보존되어 있습니다.</p><button className="button outline" onClick={() => { setSession(null); setView('bank'); }}>문제은행에서 확인</button></div>}
      {view === 'cbt' && session && currentQuestion && !isBookQuestionEligible(currentQuestion, questions) && <div className="page-content"><p>현재 문항은 수정되었거나 검수가 끝나지 않아 응시 화면에 표시할 수 없습니다. 답안과 응시 기록은 보존되어 있습니다. 원본과 대조해 승인하면 이 자리에서 이어서 풀 수 있습니다.</p><div className="blocked-question-actions"><button className="button primary" onClick={() => void verifyQuestion(currentQuestion)}>{currentQuestion.book ? '원본 대조 검수 열기' : '검수 확인'}</button><button className="button outline" disabled={session.index === 0} onClick={() => moveToQuestion(session.index - 1)}>이전 문제</button><button className="button outline" disabled={session.index >= session.questionIds.length - 1} onClick={() => moveToQuestion(session.index + 1)}>다음 문제</button><button className="button outline" onClick={() => { setSession(null); setView('bank'); }}>문제은행에서 확인</button></div></div>}
      {view === 'cbt' && !session && <div className="page-content"><EmptyState icon="book" title="진행 중인 시험이 없습니다" text="모의시험을 선택해 학습을 시작해 주세요." action="시험 선택" onAction={() => setView('examSetup')}/></div>}
      {view === 'result' && result && <ResultPage attempt={result} questions={questions} onAgain={() => setView('examSetup')} onMistakes={() => setView('mistakes')} onEdit={setShowEditor} />}
      {view === 'mistakes' && <section className="page-content"><PageHeading eyebrow="복습" title="오답노트" description={`제출한 시험의 오답과 미응답을 모았습니다. 복습에서 연속 ${REVIEW_GRADUATION_STREAK}번 맞히면 목록에서 빠집니다.`} action={<button className="button primary" disabled={!reviewQuestions.length} onClick={() => { setSetupMode('wrong'); setView('examSetup'); }}><Icon name="play"/>오답·미응답 복습</button>}/><div className="collection-summary"><span><strong>{reviewQuestions.length}</strong>개의 복습 대상</span><span>오답 {reviewItems.filter((item) => item.state === 'wrong').length}문항</span><span>미응답 {reviewItems.filter((item) => item.state === 'unanswered').length}문항</span><span>총 응시 {user.attempts.length}회</span></div><QuestionCollection reviewStates={reviewStates} reviewStreaks={reviewStreaks} empty={user.attempts.length ? { title: '복습할 문제를 모두 정리했어요', text: `틀린 문제는 연속 ${REVIEW_GRADUATION_STREAK}번 맞히면 이 목록에서 빠집니다. 새 문제를 풀며 범위를 넓혀 보세요.`, action: '새 20문항 풀기' } : { title: '아직 제출한 시험이 없어요', text: '20문항을 풀고 제출하면 틀린 문제와 못 푼 문제가 여기에 모입니다.', action: '과목별 20문항 풀기' }} onEmptyAction={() => { setSetupMode('subject'); setView('examSetup'); }} questions={reviewQuestions} allQuestions={questions} scheme={scheme} onBookmark={toggleBookmark} bookmarks={user.bookmarks} onEdit={(question) => { setShowEditor(question); setView('bank'); }} reportedIds={new Set((user.errorReports ?? []).filter((report) => report.status === 'open').map((report) => report.questionId))} onReport={(question) => setReportTarget({ question, context: 'review' })}/></section>}
      {view === 'stats' && <StatsPage questions={questions} attempts={user.attempts} scheme={scheme} setScheme={setScheme} onHistory={() => setView('history')} />}
      {view === 'history' && <HistoryPage attempts={user.attempts} questions={questions} onBack={() => setView('stats')} />}
      {view === 'bank' && <section className="page-content bank-page"><PageHeading eyebrow="문제 관리" title="문제은행" description="문제를 추가하거나 가져온 뒤 정답·해설·과목을 확인하고 승인하세요. 검수 완료 문제만 출제됩니다." action={<button className="button primary" onClick={() => setShowEditor('new')}><Icon name="plus"/>문제 추가</button>}/>
        <div className="bank-toolbar"><div className="bank-tabs">{(['all', 'verified', 'pending'] as const).map((filter) => <button className={bankFilter === filter ? 'active' : ''} key={filter} onClick={() => setBankFilter(filter)}>{filter === 'all' ? '전체' : filter === 'verified' ? '검수 완료' : '검수 대기'}<span>{filter === 'all' ? questions.length : filter === 'verified' ? verifiedQuestions.length : pendingCount}</span></button>)}</div><label className="bank-subject-filter"><span>과목</span><select value={bankSubjectFilter} onChange={(event) => setBankSubjectFilter(event.target.value)}><option value="all">전체 과목</option>{SUBJECTS.legacy.map((subject) => <option key={subject}>{subject}</option>)}</select></label><label className="bank-symbol-filter"><input type="checkbox" checked={bankAiOnly} onChange={(event) => setBankAiOnly(event.target.checked)}/>AI 대조 승인만 <strong>{aiReviewCount}</strong></label><label className="bank-symbol-filter"><input type="checkbox" checked={bankSymbolOnly} onChange={(event) => setBankSymbolOnly(event.target.checked)}/>기호·오탈자 의심만 <strong>{symbolReviewIds.size}</strong></label><label className="search-field"><Icon name="search" size={17}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="문제·과목 검색" aria-label="문제·과목 검색"/></label><div className="bank-actions"><button className="button outline" onClick={() => go('corrections')}><Icon name="edit"/>교정안 검토</button><button className="button outline" onClick={() => go('bookImport')}>교재 ZIP 가져오기</button><label className="button outline file-button"><Icon name="upload"/>JSON 가져오기<input type="file" accept="application/json,.json" onChange={importQuestionFile}/></label><button className="button outline" onClick={() => exportFile('industrial-safety-question-bank.json', { version: 1, questions })}><Icon name="download"/>내보내기</button></div></div>
        {Boolean(user.errorReports?.length) && <ErrorReportPanel reports={user.errorReports!} questions={questions} onStatus={changeErrorReportStatus} onDelete={deleteErrorReport} onExport={() => exportFile(`industrial-safety-cbt-error-reports-${new Date().toISOString().slice(0, 10)}.json`, errorReportExport(user.errorReports!, questions, new Date().toISOString()))}/>}
        <div className="bank-backup-actions"><button className="text-button" onClick={() => exportFile('industrial-safety-cbt-backup.json', { version: 1, exportedAt: new Date().toISOString(), questionBank: questions, userData: user })}><Icon name="download" size={15}/>전체 데이터 백업</button><label className="text-button restore-button"><Icon name="upload" size={15}/>백업 복원<input type="file" accept="application/json,.json" onChange={restoreBackup}/></label><span>문제은행과 학습기록을 별도 항목으로 내보냅니다.</span><button className="text-button danger-text" onClick={() => void resetLocalData()}><Icon name="trash" size={15}/>전체 초기화</button></div>
        {questions.length > 0 && <div className="bank-summary"><div><span className="summary-dot green"/>검수 완료 <strong>{verifiedQuestions.length}</strong></div><div><span className="summary-dot amber"/>검수 대기 <strong>{pendingCount}</strong></div><div className="bank-hint">문제 내용은 이 기기의 IndexedDB에 저장됩니다.</div></div>}
        {bankRows.length ? <div className="bank-subject-groups">{(bankSubjectFilter === 'all' ? [...new Set([...SUBJECTS.legacy, ...bankRows.map((question) => subjectFor(question, 'legacy') || question.originalSubject)])] : [bankSubjectFilter]).map((subject) => {
          const group = bankRows.filter((question) => (subjectFor(question, 'legacy') || question.originalSubject) === subject);
          return group.length ? <section className="bank-subject-group" key={subject}><header><strong>{subject}</strong><span>{group.length}문항</span></header><div className="bank-list">{group.map((question) => <BankRow key={question.id} question={question} eligible={eligibleQuestionIds.has(question.id)} symbolReview={symbolReviewIds.has(question.id)} onEdit={() => setShowEditor(question)} onVerify={() => void verifyQuestion(question)} onDelete={() => void removeQuestion(question)} />)}</div></section> : null;
        })}</div> : <EmptyState icon="folder" title={questions.length ? '조건에 맞는 문제가 없습니다' : '아직 문제가 없습니다'} text={questions.length ? '검색어, 과목 또는 검수 상태를 바꿔보세요.' : 'PDF에서 추출해 과목별로 정리하거나 직접 추가할 수 있습니다. 검수 완료 문제만 시험에 출제됩니다.'} action={questions.length ? undefined : '첫 문제 추가'} onAction={questions.length ? undefined : () => setShowEditor('new')}/>}
      </section>}
      {view === 'corrections' && <Suspense fallback={<div className="page-content">교정안 검토 화면을 불러오는 중...</div>}><CorrectionReview questions={questions} eligibleIds={eligibleQuestionIds} file={correctionFile} onFile={setCorrectionFile} onPropose={openCorrection} onReview={(question) => setShowEditor(question)}/></Suspense>}
      {view === 'transfer' && <Suspense fallback={<div className="page-content">기기 이전 도구를 불러오는 중...</div>}><DeviceTransfer onImported={() => window.location.reload()}/></Suspense>}
      {view === 'bookImport' && <Suspense fallback={<div className="page-content">교재 가져오기 도구를 불러오는 중...</div>}><BookImporter questions={questions} onImported={async () => setQuestions(await getQuestions())} onReview={setShowEditor}/></Suspense>}
      {view === 'pdfImport' && <Suspense fallback={<div className="page-content loading-screen"><p>PDF 처리 도구를 불러오는 중...</p></div>}><PdfImporter questions={questions} onQuestionApproved={(question) => { setQuestions((items) => [question, ...items]); setNotice('검수 승인 문항을 문제은행에 등록했습니다.'); window.setTimeout(() => setNotice(''), 5000); }}/></Suspense>}
      {view !== 'cbt' && <footer className="page-footer"><span>산업안전기사 CBT 학습 시스템</span><span>개인 학습 데이터는 이 기기에 저장됩니다</span></footer>}
    </main>

    {view !== 'cbt' && <MobileNavigation view={view} onNavigate={go}/>}
    {exitConfirm && view === 'cbt' && session && <ExitConfirmSheet session={session} remaining={remaining} onStay={() => setExitConfirm(false)} onLeave={() => { setExitConfirm(false); setSession(null); setView('dashboard'); }}/>}
    {reportTarget && <ErrorReportSheet key={reportTarget.question.id} question={reportTarget.question} existing={openReportFor(user.errorReports, reportTarget.question.id)} onClose={() => setReportTarget(null)} onSave={(fields, note) => saveErrorReport(reportTarget, fields, note)}/>}
    {showEditor && showEditor !== 'new' && showEditor.book ? <Suspense fallback={<div className="modal-backdrop">검수 화면을 불러오는 중...</div>}><BookReviewEditor key={`${showEditor.id}:${proposal?.question.id === showEditor.id ? 'proposal' : 'saved'}`} question={showEditor} questions={questions} proposal={proposal?.question.id === showEditor.id ? proposal.question : undefined} proposalNotes={proposal?.question.id === showEditor.id ? proposal.notes : undefined} proposeCandidateImage={proposal?.question.id === showEditor.id && proposal.useCandidate} onClose={() => setShowEditor(null)} onSave={saveEditedQuestion} onApprove={approveBookQuestion}/></Suspense> : showEditor && <QuestionEditor key={showEditor === 'new' ? 'new' : showEditor.id} question={showEditor === 'new' ? undefined : showEditor} onClose={() => setShowEditor(null)} onSave={saveEditedQuestion} />}
  </div>;
}

function viewTitle(view: View) {
  const titles: Record<View, string> = { dashboard: '대시보드', examSetup: '모의시험', cbt: '시험 진행', result: '시험 결과', mistakes: '오답노트', stats: '학습 통계', history: '응시 이력', bank: '문제은행', corrections: '교정안 검토', pdfImport: 'PDF 가져오기', bookImport: '교재 ZIP', phone: '휴대폰 연결', transfer: '기기 이전·백업' };
  return titles[view];
}

export function MobileNavigation({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  const [expanded, setExpanded] = useState(false);
  const moreViews: View[] = ['bank', 'corrections', 'pdfImport', 'bookImport', 'phone', 'transfer'];
  const item = (target: View, icon: string, label: string) => <button key={target} className={view === target ? 'active' : ''}
    aria-current={view === target ? 'page' : undefined} onClick={() => { setExpanded(false); onNavigate(target); }}><Icon name={icon}/><span>{label}</span></button>;
  return <nav className="mobile-nav" aria-label="모바일 메뉴">
    {expanded && <div className="mobile-more-menu" id="mobile-more-menu" aria-label="관리 메뉴">
      {item('bank', 'folder', '문제은행')}{item('bookImport', 'book', '교재 ZIP')}
      {item('pdfImport', 'upload', 'PDF 가져오기')}{item('phone', 'phone', '휴대폰 연결')}{item('transfer', 'download', '기기 이전·백업')}
    </div>}
    {item('dashboard', 'home', '홈')}{item('examSetup', 'book', '시험')}{item('mistakes', 'warning', '복습')}{item('stats', 'chart', '통계')}
    <button className={moreViews.includes(view) ? 'active' : ''} aria-expanded={expanded} aria-controls={expanded ? 'mobile-more-menu' : undefined}
      onClick={() => setExpanded((current) => !current)}><Icon name={expanded ? 'close' : 'folder'}/><span>{expanded ? '닫기' : '더보기'}</span></button>
  </nav>;
}

function NavItem({ active, icon, label, onClick, count, badge }: { active: boolean; icon: string; label: string; onClick: () => void; count?: number; badge?: string }) {
  return <button aria-label={label} title={label} className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><span className="nav-icon"><Icon name={icon}/></span><span>{label}</span>{badge && <small className="nav-badge">{badge}</small>}{count ? <small className="nav-count">{count}</small> : null}</button>;
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="heading-action">{action}</div>}</div>;
}

export function Dashboard({ questionCount, pendingCount, stats, wrongCount, bookmarks, recentAttempt, scheme, setScheme, questions, attempts, onExam, onBank, onMistakes, onResume, activeSession, onHistory, onSubjectStart, onOfficialStart }: {
  questionCount: number; pendingCount: number; stats: { answered: number; correct: number; accuracy: number }; wrongCount: number; bookmarks: number;
  recentAttempt?: Attempt; scheme: SchemeId; setScheme: (scheme: SchemeId) => void; questions: Question[]; attempts: Attempt[]; onExam: () => void; onBank: () => void; onMistakes: () => void; onResume: () => void; activeSession?: ActiveSession; onHistory: () => void;
  onSubjectStart?: (subject?: string) => void; onOfficialStart?: () => void;
}) {
  const score = recentAttempt ? scoreAttempt(recentAttempt, questions) : undefined;
  const weakest = subjectAccuracy(questions, attempts, scheme, SUBJECTS[scheme]).filter((row) => row.count > 0).sort((a, b) => a.percent - b.percent || b.count - a.count)[0];
  return <section className="page-content dashboard-page">
    <div className="welcome-row"><div><span className="eyebrow">2026 산업안전기사 필기 준비</span><h1>안녕하세요, 오늘도 안전하게 합격까지.</h1><p>기출을 반복하고, 취약한 과목을 하나씩 정리해 보세요.</p></div><div className="scheme-select-wrap"><span>출제 기준</span><select value={scheme} onChange={(event) => setScheme(event.target.value as SchemeId)}><option value="legacy">2024–2026 기준</option><option value="revised">2027–2029 기준</option></select></div></div>
    {activeSession && <button className="resume-banner" onClick={onResume}><span className="resume-play"><Icon name="play"/></span><span><strong>진행 중인 시험이 있어요</strong><small>{activeSession.title} · {activeSession.questionIds.length}문제</small></span><span className="resume-link">이어서 풀기 <Icon name="arrow" size={16}/></span></button>}
    <div className="hero-card"><div className="hero-content"><span className="hero-pill"><Icon name="shield" size={14}/> 나만의 CBT 학습 공간</span><h2>꾸준한 반복이<br/>합격을 만듭니다.</h2><p>내 기출문제로 실전처럼 연습하고<br/>취약 과목을 정확하게 파악하세요.</p><div className="hero-actions"><button className="button hero-button" onClick={onExam}>모의시험 시작 <Icon name="arrow" size={16}/></button><button className="hero-link" onClick={onBank}>문제은행 관리 <Icon name="arrow" size={14}/></button></div></div><div className="hero-visual" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="hero-shield"><Icon name="shield" size={66}/><span><Icon name="check" size={29}/></span></div><div className="float-card float-score"><span className="float-spark">✦</span><div><strong>{stats.answered ? `${stats.accuracy}%` : '준비 완료'}</strong><small>나의 정답률</small></div></div><div className="float-card float-questions"><span className="float-small-icon"><Icon name="book" size={16}/></span><div><strong>{questionCount}</strong><small>검수 완료 문제</small></div></div><div className="hero-dot dot-a"/><div className="hero-dot dot-b"/><div className="hero-dot dot-c"/></div><div className="hero-wave"/></div>
    <div className="metric-grid"><MetricCard label="검수 완료 문제" value={questionCount.toLocaleString()} suffix="문제" icon="book" tone="blue" detail={pendingCount ? `검수 대기 ${pendingCount}문제` : '문제은행에 등록된 문항'} onClick={onBank}/><MetricCard label="누적 응시" value={stats.answered.toLocaleString()} suffix="문제" icon="chart" tone="violet" detail={`${stats.correct}문제 정답`} onClick={onHistory}/><MetricCard label="평균 정답률" value={stats.answered ? stats.accuracy : '—'} suffix={stats.answered ? '%' : ''} icon="check" tone="mint" detail={stats.answered ? '전체 응시 기준' : '첫 시험을 시작해 보세요'} onClick={onHistory}/><MetricCard label="복습할 문제" value={wrongCount} suffix="문제" icon="warning" tone="amber" detail={bookmarks ? `북마크 ${bookmarks}문제` : '오답·미응답을 복습해 보세요'} onClick={onMistakes}/></div>
    <div className="dashboard-grid"><div className="dashboard-main-column"><div className="panel focus-panel"><div className="panel-heading"><div><span className="eyebrow">빠른 학습</span><h2>무엇부터 시작할까요?</h2></div><button className="text-button" onClick={onExam}>학습 방식 보기 <Icon name="arrow" size={14}/></button></div><div className="start-grid">
          <button type="button" className="start-card" onClick={() => onSubjectStart ? onSubjectStart(weakest?.subject) : onExam()}><span className="quick-icon lavender"><Icon name="chart"/></span><span className="start-copy"><strong>과목별로 차근차근</strong><small>과목 하나를 골라 20문항씩 · 정답·해설 바로 확인</small>{weakest ? <em className={weakest.failing ? 'is-failing' : ''}>추천 과목: {weakest.subject} · 정답률 {weakest.percent}%</em> : <em>처음이라면 1과목부터 시작해 보세요</em>}</span><span className="quick-arrow"><Icon name="arrow" size={15}/></span></button>
          <button type="button" className="start-card" onClick={() => onOfficialStart ? onOfficialStart() : onExam()}><span className="quick-icon peach"><Icon name="clock"/></span><span className="start-copy"><strong>실전 모의고사로 약점 찾기</strong><small>{SCHEME_INFO[scheme].count}문항 · {SCHEME_INFO[scheme].minutes}분 · 끝난 뒤 과목별 채점</small><em>과락 과목을 한 번에 확인합니다</em></span><span className="quick-arrow"><Icon name="arrow" size={15}/></span></button>
        </div><div className="quick-grid start-secondary"><QuickAction icon="warning" title="오답·미응답 복습" description={`${wrongCount}문제 복습 대기`} tint="peach" onClick={onMistakes}/></div></div><div className="panel subject-panel"><div className="panel-heading"><div><span className="eyebrow">과목별 학습</span><h2>과목별 정답률</h2></div><select className="mini-select" value={scheme} onChange={(event) => setScheme(event.target.value as SchemeId)}><option value="legacy">2024–2026</option><option value="revised">2027–2029</option></select></div><SubjectBars questions={questions} attempts={attempts} scheme={scheme} compact/></div></div><div className="dashboard-side-column"><div className="panel recent-panel"><div className="panel-heading"><div><span className="eyebrow">최근 학습</span><h2>최근 응시 이력</h2></div><button className="icon-button subtle" aria-label="전체 이력" onClick={onHistory}><Icon name="arrow" size={17}/></button></div>{recentAttempt ? <div className="recent-attempt"><span className="recent-icon"><Icon name="book"/></span><div><strong>{recentAttempt.title}</strong><small>{new Date(recentAttempt.submittedAt).toLocaleDateString('ko-KR')} · {recentAttempt.questionIds.length}문제</small></div><strong className="recent-percent">{score?.score ?? '—'}%</strong></div> : <div className="empty-recent"><div className="empty-icon"><Icon name="clock" size={22}/></div><strong>아직 응시 이력이 없어요</strong><p>첫 모의시험을 마치면<br/>여기서 결과를 볼 수 있어요.</p><button className="text-button" onClick={onExam}>시험 시작하기 <Icon name="arrow" size={14}/></button></div>}</div><div className="tip-card"><span className="tip-icon">✦</span><div><strong>오늘의 학습 팁</strong><p>틀린 문제는 정답만 외우기보다<br/>해설을 읽고 오답 원인을 기록해 보세요.</p></div><span className="tip-decoration">✳</span></div></div></div>
  </section>;
}

function MetricCard({ label, value, suffix, icon, tone, detail, onClick }: { label: string; value: string | number; suffix: string; icon: string; tone: string; detail: string; onClick: () => void }) {
  return <button className="metric-card" onClick={onClick}><div className={`metric-icon ${tone}`}><Icon name={icon}/></div><span className="metric-label">{label}</span><div className="metric-value">{value}<small>{suffix}</small></div><span className="metric-detail">{detail}</span><span className="metric-arrow"><Icon name="arrow" size={15}/></span></button>;
}

function QuickAction({ icon, title, description, tint, onClick }: { icon: string; title: string; description: string; tint: string; onClick: () => void }) {
  return <button className="quick-action" onClick={onClick}><span className={`quick-icon ${tint}`}><Icon name={icon}/></span><strong>{title}</strong><small>{description}</small><span className="quick-arrow"><Icon name="arrow" size={15}/></span></button>;
}

function SubjectBars({ questions, attempts, scheme, compact = false, emptyTitle, emptyText }: { questions: Question[]; attempts: Attempt[]; scheme: SchemeId; compact?: boolean; emptyTitle?: string; emptyText?: string }) {
  const rows = subjectAccuracy(questions, attempts, scheme, SUBJECTS[scheme]);
  if (!attempts.length) return <div className={`subject-empty ${compact ? 'compact' : ''}`}><div className="empty-chart"><div/><div/><div/><div/><div/></div><strong>{emptyTitle ?? '아직 과목별 기록이 없어요'}</strong><p>{emptyText ?? '문제를 풀면 과목별 정답률을 분석해 드려요.'}</p></div>;
  return <div className="subject-bars">{rows.map((row) => <div className={`subject-bar-row ${row.failing ? 'is-failing' : ''}`} key={row.subject}><div className="subject-bar-title"><span>{row.subject}{row.failing && <em className="fail-badge">과락 위험</em>}</span><strong>{row.count ? `${row.percent}%` : '—'}{row.count > 0 && <small>{row.correct}/{row.count}문항</small>}</strong></div><div className="bar-track" role="img" aria-label={row.count ? `${row.subject} 정답률 ${row.percent}%, ${row.count}문항 중 ${row.correct}문항 정답${row.failing ? ', 40% 미만 과락 위험' : ''}` : `${row.subject} 기록 없음`}><span className={row.failing ? 'fail-bar' : undefined} style={{ width: `${row.percent}%` }}/></div></div>)}</div>;
}

const CHOICE_MARKS = ['①', '②', '③', '④'];
function choiceMark(answer: number | null | undefined): string {
  return answer != null && answer >= 1 && answer <= CHOICE_MARKS.length ? CHOICE_MARKS[answer - 1] : `${answer ?? '—'}`;
}

type AnswerState = 'correct' | 'wrong' | 'unanswered';
const ANSWER_STATE_LABEL: Record<AnswerState, string> = { correct: '정답', wrong: '오답', unanswered: '미응답' };
const ANSWER_STATE_ICON: Record<AnswerState, string> = { correct: 'check', wrong: 'close', unanswered: 'minus' };

function answerState(question: Question, selected: number | undefined): AnswerState {
  return selected === undefined ? 'unanswered' : selected === question.answer ? 'correct' : 'wrong';
}

/** Summary row: [정답 ③] [내 답 ② · 오답] [과목 · 연도 · 회차]. Missing source fields stay empty. */
export function AnswerGlance({ question, selected, scheme }: { question: Question; selected: number | undefined; scheme: SchemeId }) {
  const state = answerState(question, selected);
  const source = [
    subjectFor(question, scheme) || question.originalSubject,
    question.year ? `${question.year}년` : '',
    question.round,
    !question.year && !question.round && question.book?.originalNumber != null ? `교재 ${question.book.originalNumber}번` : '',
  ].filter(Boolean).join(' · ');
  return <div className="answer-glance" role="group" aria-label="정답 요약">
    <span className="glance-chip answer"><Icon name="check" size={14}/>정답 {question.answer == null ? '검수 필요' : choiceMark(question.answer)}</span>
    <span className={`glance-chip mine ${state}`}><Icon name={ANSWER_STATE_ICON[state]} size={14}/>내 답 {selected === undefined ? '없음' : choiceMark(selected)} · {ANSWER_STATE_LABEL[state]}</span>
    {source && <span className="glance-chip meta">{source}</span>}
  </div>;
}

function ReadingScaleControl({ value, onChange }: { value: ReadingScale; onChange: (scale: ReadingScale) => void }) {
  return <div className="reading-scale" role="group" aria-label="본문 글자 크기">{READING_SCALES.map((scale) => <button type="button" key={scale.id} className={`reading-scale-${scale.id} ${value === scale.id ? 'active' : ''}`} aria-pressed={value === scale.id} aria-label={`글자 크기 ${scale.label}`} onClick={() => onChange(scale.id)}>가</button>)}</div>;
}

export function CBTScreen({ question, session, questions, remaining, user, onAnswer, onCheck, onNavigate, onBookmark, onMarked, onSubmit, onExit, readingScale, onReadingScale, onEdit, onReport }: {
  question: Question; session: ActiveSession; questions: Question[]; remaining: number; user: UserData; onAnswer: (answer: number) => void; onCheck: () => void; onNavigate: (index: number) => void; onBookmark: () => void; onMarked: () => void; onSubmit: () => void; onExit: () => void;
  readingScale?: ReadingScale; onReadingScale?: (scale: ReadingScale) => void; onEdit?: () => void; onReport?: () => void;
}) {
  const isReported = Boolean(openReportFor(user.errorReports, question.id));
  const answeredCount = Object.keys(session.answers).length;
  const questionNo = question.book?.originalNumber ?? session.index + 1;
  const sourceNumber = (id: string, index: number) => questions.find((item) => item.id === id)?.book?.originalNumber ?? index + 1;
  const isBookmarked = user.bookmarks.includes(question.id);
  const isMarked = session.markedIds.includes(question.id);
  const feedbackEnabled = supportsPracticeFeedback(session);
  const checked = feedbackEnabled && Boolean(session.checkedQuestionIds?.includes(question.id));
  const selectedAnswer = session.answers[question.id];
  const correct = checked && selectedAnswer === question.answer;
  const isLast = session.index === session.questionIds.length - 1;
  const canCheck = feedbackEnabled && !checked && Boolean(selectedAnswer) && question.answer !== null;
  const showOriginalExplanation = Boolean(question.book && question.explanation.split(/\r?\n/).length >= 4);
  const originalExplanation = question.book && <details className="feedback-original" open={showOriginalExplanation || undefined}><summary>책 원본 해설 이미지 보기</summary>{showOriginalExplanation && <p className="original-reading-note">줄바꿈·표가 있는 해설은 원본을 함께 확인하세요. 이미지를 원본 크기로 열면 확대해서 읽을 수 있습니다.</p>}<BookStoredImage imageId={question.book.reviewImageId} purpose="review" alt="정답 확인 후 보는 교재 원본 해설"/></details>;
  const isCompactViewport = () => window.innerWidth <= 700 || window.innerWidth <= 950 && window.innerHeight <= 500;
  const isWideViewport = () => window.innerWidth >= 1024;
  const [showMap, setShowMap] = useState(() => !isCompactViewport());
  const [wide, setWide] = useState(isWideViewport);
  // Wide practice screens: number strip on top, question left, explanation right.
  const practiceLayout = feedbackEnabled && wide;
  const mapOpen = showMap || practiceLayout;
  const questionTop = useRef<HTMLDivElement>(null);
  const previousQuestion = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousQuestion.current !== question.id) questionTop.current?.scrollIntoView({ block: 'start' });
    previousQuestion.current = question.id;
  }, [question.id]);
  useEffect(() => {
    const update = () => setWide(isWideViewport());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  const handleShortcut = useRef<(event: KeyboardEvent) => void>(() => {});
  handleShortcut.current = (event) => {
    // An open editor/review dialog owns the keyboard; never answer or move underneath it.
    if (document.querySelector('[aria-modal="true"]')) return;
    const action = resolveCbtShortcut(
      { key: event.key, isComposing: event.isComposing, modifier: event.metaKey || event.ctrlKey || event.altKey, target: shortcutTargetKind(event.target) },
      { checked, canCheck, index: session.index, total: session.questionIds.length, choiceCount: question.choices.length },
    );
    if (!action) return;
    event.preventDefault();
    if (action.type === 'answer') onAnswer(action.value);
    else if (action.type === 'move') onNavigate(action.index);
    else onCheck();
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleShortcut.current(event);
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, []);
  const feedback = checked && <section className={`practice-feedback ${correct ? 'is-correct' : 'is-wrong'}`} aria-label="정답과 해설" role="status">
    <div className="feedback-heading"><strong>{correct ? '정답입니다' : '오답입니다'}</strong><AnswerGlance question={question} selected={selectedAnswer} scheme={session.scheme}/></div>
    <p className="feedback-answer">{question.answer === null ? '' : question.choices[question.answer - 1]}</p>
    <h2>해설</h2>{showOriginalExplanation ? <>{originalExplanation}<details className="feedback-text"><summary>텍스트 해설 보기</summary><ExplanationText className="feedback-explanation" text={bookExplanationText(question, questions)} emphasizeLead/></details></> : <><ExplanationText className="feedback-explanation" text={bookExplanationText(question, questions)} emphasizeLead/>{originalExplanation}</>}
    <small>확인한 답은 기록을 위해 고정됩니다. 다음 문제로 이동해 계속 학습하세요.</small>
    {onEdit && <div className="feedback-edit"><button type="button" className="text-button" onClick={onEdit}><Icon name="edit" size={15}/>오탈자·기호 수정</button><span>원문과 다른 글자·기호를 발견하면 수정하세요. 저장하면 재검수 전까지 출제에서 빠집니다.</span></div>}
  </section>;
  const mobilePrimary = !feedbackEnabled
    ? <button className="cbt-submit cbt-primary-action" onClick={onSubmit}>제출</button>
    : !checked
      ? <button className="cbt-primary-action" disabled={!canCheck} onClick={onCheck}>정답 확인</button>
      : isLast
        ? <button className="cbt-submit cbt-primary-action" onClick={onSubmit}>학습 완료</button>
        : <button className="cbt-primary-action" onClick={() => onNavigate(session.index + 1)}>다음 문제</button>;
  return <div className="cbt-layout">
    <header className="cbt-header"><button className="cbt-brand" aria-label="학습 화면 나가기" onClick={onExit}><span className="brand-mark"><Icon name="shield" size={18}/></span><strong>안전한 합격</strong></button><div className="cbt-title"><span className="live-dot"/>{session.title}<small>{session.mode === 'book-round' ? '책 실전 연습 · 원래 번호 보존' : SCHEME_INFO[session.scheme].label}</small></div><div className={`cbt-timer ${remaining < 300 ? 'urgent' : ''}`}><Icon name="clock"/><span><small>남은 시간</small><strong>{formatClock(remaining)}</strong></span></div><button className="cbt-submit top-submit" onClick={onSubmit}>시험 제출</button><button className="icon-button cbt-exit" onClick={onExit} aria-label="시험 나가기"><Icon name="close"/></button></header>
    <div className="cbt-progress-strip"><span style={{ width: `${answeredCount / session.questionIds.length * 100}%` }}/></div>
    <div className={`cbt-content ${practiceLayout ? 'practice-layout' : ''}`}><div className="cbt-question-column" ref={questionTop}>
      <div className="question-topline"><div><span className="question-label">QUESTION</span><strong>{String(questionNo).padStart(2, '0')} <i>진행 {session.index + 1} / {session.questionIds.length}</i></strong></div><span className="question-tags"><span>{subjectFor(question, session.scheme) || question.originalSubject}</span>{(question.year || question.round) && <span>{question.year ? `${question.year}년 ` : ''}{question.round}</span>}</span></div>
      <div className="exam-question-card">
        <div className="exam-question-tools"><span>문제 {questionNo}</span>{readingScale && onReadingScale && <ReadingScaleControl value={readingScale} onChange={onReadingScale}/>}<button className={`bookmark-control ${isBookmarked ? 'active' : ''}`} onClick={onBookmark}><Icon name="bookmark" size={17}/>{isBookmarked ? '북마크됨' : '북마크'}</button>{onReport && <button className={`report-control ${isReported ? 'active' : ''}`} onClick={onReport} aria-haspopup="dialog" aria-label={isReported ? '오류 신고 수정' : '이 문제 오류 신고'}><Icon name="warning" size={16}/>{isReported ? '신고됨' : '오류 신고'}</button>}</div>
        <ReadableQuestion text={question.prompt}/>
        {question.book ? <BookExamImage question={question}/> : question.imageDataUrl && <img className="question-image" src={question.imageDataUrl} alt="문제 이미지"/>}
        <div className="answer-options">{question.choices.map((choice, index) => {
          const choiceNo = index + 1;
          const isAnswer = checked && question.answer === choiceNo;
          const isMine = selectedAnswer === choiceNo;
          const isWrongPick = checked && isMine && !correct;
          return <button key={index} className={`answer-option ${isMine ? 'selected' : ''} ${isAnswer ? 'correct-answer' : ''} ${isWrongPick ? 'wrong-answer' : ''}`} disabled={checked} aria-pressed={isMine} onClick={() => onAnswer(choiceNo)}><span className="choice-number">{choiceNo}</span><span className="choice-text">{choice}</span>{isAnswer ? <><span className="choice-state-icon correct" aria-hidden="true"><Icon name="check" size={14}/></span><span className="choice-result-label">정답{isMine ? ' · 내 답' : ''}</span></> : isWrongPick ? <><span className="choice-state-icon wrong" aria-hidden="true"><Icon name="close" size={14}/></span><span className="choice-result-label wrong">내 답 · 오답</span></> : isMine && <span className="selected-check"><Icon name="check" size={15}/></span>}</button>;
        })}</div>
        {feedbackEnabled && !checked && <div className="practice-check"><button className="button primary" disabled={!selectedAnswer || question.answer === null} onClick={onCheck}>정답·해설 확인</button><span>답을 선택한 뒤 확인하세요.</span></div>}
      </div>
      {feedbackEnabled && <div className="cbt-explanation-column">{feedback || <div className="explanation-placeholder"><strong>해설</strong><p>답을 고른 뒤 정답을 확인하면 이 자리에 해설이 표시됩니다.</p><p className="shortcut-hint"><kbd>1</kbd>–<kbd>4</kbd> 답 선택 · <kbd>Enter</kbd> 확인 · <kbd>←</kbd>/<kbd>→</kbd> 이동</p></div>}</div>}
      <div className="question-navigation"><button className="button outline" onClick={() => onNavigate(session.index - 1)} disabled={session.index === 0}><Icon name="left" size={16}/>이전 문제</button><button className={`mark-button ${isMarked ? 'marked' : ''}`} onClick={onMarked}><Icon name="flag" size={16}/>{isMarked ? '검토 표시 해제' : '나중에 검토'}</button>{isLast && feedbackEnabled ? <button className="button primary" onClick={onSubmit}>학습 완료<Icon name="check" size={16}/></button> : <button className="button primary" onClick={() => onNavigate(session.index + 1)} disabled={isLast}>다음 문제<Icon name="right" size={16}/></button>}</div>
      <div className="autosave-hint"><span className="online-dot"/> 답안과 정답 확인 상태가 이 기기에 자동 저장됩니다</div>
    </div>
      <aside className={`cbt-question-map ${mapOpen ? '' : 'collapsed'}`}><div className="map-heading"><div><strong>문제 목록</strong><span>{answeredCount} / {session.questionIds.length} 응답</span></div><button className="map-toggle" aria-label={mapOpen ? '문제 목록 닫기' : '문제 목록 열기'} aria-expanded={mapOpen} aria-controls={mapOpen ? 'cbt-question-list' : undefined} onClick={() => setShowMap((shown) => !shown)}><Icon name={mapOpen ? 'close' : 'book'} size={16}/></button></div>{mapOpen && <><div className="map-legend"><span><i className="legend-dot answered"/>응답</span><span><i className="legend-dot marked"/>검토</span><span><i className="legend-dot"/>미응답</span></div><div className="question-number-grid" id="cbt-question-list">{session.questionIds.map((id, index) => <button key={id} className={`${session.answers[id] ? 'answered' : ''} ${session.markedIds.includes(id) ? 'marked' : ''} ${index === session.index ? 'current' : ''}`} onClick={() => { onNavigate(index); if (isCompactViewport()) setShowMap(false); }} aria-current={index === session.index ? 'step' : undefined} aria-label={`${sourceNumber(id, index)}번 문제${session.answers[id] ? ' 응답함' : ' 미응답'}`}>{sourceNumber(id, index)}</button>)}</div><div className="map-bottom"><span>남은 문제 <strong>{session.questionIds.length - answeredCount}</strong></span><button onClick={() => onSubmit()}>제출 전 확인 <Icon name="arrow" size={14}/></button></div><div className="exam-progress-box"><div className="progress-ring"><span>{Math.round(answeredCount / session.questionIds.length * 100)}<small>%</small></span></div><div><strong>진행 상황</strong><small>{answeredCount}문제 답변 완료</small></div></div></>}</aside></div>
    <div className="cbt-mobile-bar"><span>{session.index + 1} / {session.questionIds.length}</span><button className="mobile-map-toggle" aria-label={showMap ? '문제 목록 닫기' : '문제 목록 열기'} aria-expanded={showMap} aria-controls={showMap ? 'cbt-question-list' : undefined} onClick={() => setShowMap((shown) => !shown)}><Icon name="book"/></button><button aria-label="이전 문제" onClick={() => onNavigate(session.index - 1)} disabled={session.index === 0}><Icon name="left"/><span className="mobile-step-label">이전</span></button>{mobilePrimary}<button aria-label="다음 문제" onClick={() => onNavigate(session.index + 1)} disabled={isLast}><span className="mobile-step-label">다음</span><Icon name="right"/></button></div>
  </div>;
}

export type ResultItem = { question: Question; position: number; selected: number | undefined; state: AnswerState };

/** Per-question outcome in session order; questions missing from the bank are skipped, never invented. */
export function resultItems(attempt: Attempt, questions: Question[]): ResultItem[] {
  const byId = new Map(questions.map((question) => [question.id, question]));
  return attempt.questionIds.flatMap((id, index) => {
    const question = byId.get(id);
    if (!question) return [];
    const selected = attempt.answers[id];
    return [{ question, position: index + 1, selected, state: answerState(question, selected) }];
  });
}

function ChoiceStates({ question, selected }: { question: Question; selected: number | undefined }) {
  return <ol className="choice-states">{question.choices.map((choice, index) => {
    const choiceNo = index + 1;
    const isAnswer = question.answer === choiceNo;
    const isMine = selected === choiceNo;
    return <li key={index} className={`choice-state ${isAnswer ? 'correct' : isMine ? 'wrong' : ''}`}><span className="choice-number">{choiceNo}</span><span className="choice-text">{choice}</span>{isAnswer ? <span className="choice-state-tag correct"><Icon name="check" size={14}/>정답{isMine ? ' · 내 답' : ''}</span> : isMine ? <span className="choice-state-tag wrong"><Icon name="close" size={14}/>내 답 · 오답</span> : null}</li>;
  })}</ol>;
}

function ResultItemsPanel({ attempt, questions, onEdit }: { attempt: Attempt; questions: Question[]; onEdit?: (question: Question) => void }) {
  const items = resultItems(attempt, questions);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [focus, setFocus] = useState<{ id: string; count: number }>();
  const visible = wrongOnly ? items.filter((item) => item.state !== 'correct') : items;
  const counts = { correct: 0, wrong: 0, unanswered: 0 };
  for (const item of items) counts[item.state]++;
  function openItem(id: string) {
    setFocus((previous) => ({ id, count: (previous?.count ?? 0) + 1 }));
    window.requestAnimationFrame(() => {
      const card = document.getElementById(`result-item-${id}`);
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      card?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
      card?.focus({ preventScroll: true });
    });
  }
  if (!items.length) return null;
  return <section className="panel result-items" aria-labelledby="result-items-title">
    <div className="panel-heading"><div><span className="eyebrow">문항별 해설</span><h2 id="result-items-title">문항 한눈에 보기</h2></div><label className="wrong-only-toggle"><input type="checkbox" checked={wrongOnly} onChange={(event) => setWrongOnly(event.target.checked)}/>오답만 보기<small>미응답 포함</small></label></div>
    <div className="result-legend"><span className="correct"><Icon name="check" size={13}/>정답 {counts.correct}</span><span className="wrong"><Icon name="close" size={13}/>오답 {counts.wrong}</span><span className="unanswered"><Icon name="minus" size={13}/>미응답 {counts.unanswered}</span></div>
    {visible.length ? <ol className="result-cell-grid">{visible.map((item) => <li key={item.question.id}><button type="button" className={`result-cell ${item.state}`} onClick={() => openItem(item.question.id)} aria-label={`${item.position}번 ${ANSWER_STATE_LABEL[item.state]}, 해설로 이동`}><span className="result-cell-no">{item.position}</span><Icon name={ANSWER_STATE_ICON[item.state]} size={13}/></button></li>)}</ol> : <p className="result-empty">오답·미응답 문항이 없습니다.</p>}
    <div className="result-explanations">{visible.map((item) => <article className={`result-explanation-card ${item.state}`} id={`result-item-${item.question.id}`} tabIndex={-1} key={item.question.id}>
      <header><span className={`result-card-no ${item.state}`}>{item.position}번 · {ANSWER_STATE_LABEL[item.state]}</span><AnswerGlance question={item.question} selected={item.selected} scheme={attempt.scheme}/>{onEdit && <button type="button" className="text-button result-edit" onClick={() => onEdit(item.question)}><Icon name="edit" size={15}/>오탈자·기호 수정</button>}</header>
      <ReadableQuestion text={item.question.prompt} as="h3"/>
      {item.question.book ? <BookExamImage question={item.question}/> : item.question.imageDataUrl && <img className="question-image small" src={item.question.imageDataUrl} alt="문제 이미지"/>}
      <ChoiceStates question={item.question} selected={item.selected}/>
      <ReviewExplanation text={bookExplanationText(item.question, questions)} forceOpen={focus?.id === item.question.id ? focus.count : 0} emphasizeLead {...originalExplanationProps(item.question)}/>
    </article>)}</div>
  </section>;
}

export function ResultPage({ attempt, questions, onAgain, onMistakes, onEdit }: { attempt: Attempt; questions: Question[]; onAgain: () => void; onMistakes: () => void; onEdit?: (question: Question) => void }) {
  const score = scoreAttempt(attempt, questions);
  const byId = new Map(questions.map((question) => [question.id, question]));
  const wrong = attempt.questionIds.map((id) => byId.get(id)).filter((question): question is Question => Boolean(question && attempt.answers[question.id] !== question.answer));
  const unansweredCount = wrong.filter((question) => attempt.answers[question.id] === undefined).length;
  // Q-Net: a subject under 40 points fails (과락). A single-subject set shows only that, never a pass verdict.
  const subjectRow = attempt.mode === 'subject' && score.subjectScores.length === 1 ? score.subjectScores[0] : undefined;
  const showCutoff = score.fullExam || Boolean(subjectRow);
  const subjectFailed = Boolean(subjectRow && subjectRow.value < 40);
  return <section className="page-content result-page"><PageHeading eyebrow="시험 결과" title="수고하셨습니다!" description={`${new Date(attempt.submittedAt).toLocaleString('ko-KR')} 응시 결과입니다.`} action={<button className="button outline" onClick={onAgain}>다른 학습 선택</button>}/><div className={`result-hero ${score.passed ? 'passed' : ''} ${subjectFailed ? 'cutoff-failed' : ''}`}><div className="result-score-ring"><span>{score.score}<small>점</small></span></div><div>{subjectRow ? <><span className={`result-status ${subjectFailed ? 'fail-text' : ''}`}>{subjectFailed ? <><Icon name="warning" size={13}/> 과락 (40점 미만)</> : <><Icon name="check" size={13}/> 과락 기준 통과 (40점 이상)</>}</span><h2>{subjectRow.subject} {subjectRow.score}점</h2><p>정답 {score.correct} / {score.total}문항 · 응답 {score.answered} / {score.total}문항. 큐넷 기준 과목 40점 미만은 과락이며, 합격(평균 60점 이상) 판정은 정식 시험에서만 합니다.</p></> : <><span className="result-status">{score.fullExam ? score.passed ? '합격 기준 충족' : '합격 기준 미달' : '연습 결과'}</span><h2>{score.fullExam ? score.passed ? '합격을 축하합니다!' : '조금만 더 복습해봐요.' : `${score.correct}문제 정답`}</h2><p>{score.fullExam ? '과목별 과락 기준과 평균 점수를 확인해 보세요.' : `응답 ${score.answered} / ${score.total}문제 · 정식 분량이 아니므로 합격 여부는 판정하지 않습니다.`}</p></>}</div><div className="result-hero-meta"><span>소요 시간<strong>{formatClock(Math.max(0, Math.round((new Date(attempt.submittedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000)) )}</strong></span><span>정답률<strong>{score.score}%</strong></span></div></div><div className="result-grid"><div className="panel result-subjects"><div className="panel-heading"><div><span className="eyebrow">상세 결과</span><h2>과목별 점수</h2></div><span className="scheme-chip">{SCHEME_INFO[attempt.scheme].label}</span></div>{score.subjectScores.map((row) => <div className="result-subject-row" key={row.subject}><div className="result-subject-name"><span>{row.subject}</span><strong className={row.score < 40 ? 'fail-text' : ''}>{row.score}%</strong></div><div className="bar-track"><span className={row.score < 40 ? 'fail-bar' : ''} style={{ width: `${row.score}%` }}/></div><small>{row.correct} / {row.count} 정답 {showCutoff && row.value < 40 && <em>과락</em>}</small></div>)}</div><div className="panel result-review"><div className="panel-heading"><div><span className="eyebrow">복습</span><h2>다시 볼 문제</h2></div><span className="wrong-count">{wrong.length}문제</span></div>{wrong.length ? <><p className="review-intro">오답 {wrong.length - unansweredCount}문항 · 미응답 {unansweredCount}문항. 해설을 읽고 다시 풀어보세요.</p><div className="wrong-review-list">{wrong.slice(0, 5).map((question) => <div className="wrong-review-item" key={question.id}><span className={`wrong-x ${attempt.answers[question.id] === undefined ? 'unanswered' : ''}`}>{attempt.answers[question.id] === undefined ? '—' : '×'}</span><div><strong>{question.prompt}</strong><small>{attempt.answers[question.id] === undefined ? '미응답' : '오답'} · 내 답 {attempt.answers[question.id] ? `${attempt.answers[question.id]}번` : '미응답'} · 정답 {question.answer}번</small></div></div>)}</div><button className="button outline full-width" onClick={onMistakes}>오답노트에서 전체 보기 <Icon name="arrow" size={15}/></button></> : <div className="all-correct"><span><Icon name="check" size={22}/></span><strong>모든 문제를 맞혔어요!</strong><p>좋은 결과예요. 꾸준히 이어가세요.</p></div>}</div></div><ResultItemsPanel attempt={attempt} questions={questions} onEdit={onEdit}/><div className="result-bottom-actions"><button className="button primary" onClick={onAgain}><Icon name="play" size={16}/>다시 학습하기</button><button className="button outline" onClick={onMistakes}><Icon name="warning" size={16}/>오답노트 보기</button></div></section>;
}

/** Review lists come after submission, so the answer-bearing book image may be shown; it loads only when opened. */
function ReviewOriginalExplanation({ imageId, multiline }: { imageId: string; multiline: boolean }) {
  const [open, setOpen] = useState(false);
  return <details className="feedback-original review-original" onToggle={(event) => setOpen(event.currentTarget.open)}><summary>책 원본 해설 이미지 보기</summary>{open && <>{multiline && <p className="original-reading-note">줄바꿈·표가 있는 해설은 원본을 함께 확인하세요. 이미지를 원본 크기로 열면 확대해서 읽을 수 있습니다.</p>}<BookStoredImage imageId={imageId} purpose="review" alt="정답 확인 후 보는 교재 원본 해설"/></>}</details>;
}

function ReviewExplanation({ text, forceOpen = 0, emphasizeLead = false, originalImageId, originalMultiline = false }: { text: string; forceOpen?: number; emphasizeLead?: boolean; originalImageId?: string; originalMultiline?: boolean }) {
  const long = text.length > 220 || text.split(/\r?\n/u).filter((line) => line.trim()).length > 5;
  const [expanded, setExpanded] = useState(!long);
  useEffect(() => { if (forceOpen) setExpanded(true); }, [forceOpen]);
  return <section className="collection-explanation-panel" aria-label="해설"><h4>해설</h4><details className="collection-explanation-details" open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}><summary>{expanded ? '해설 접기' : '긴 해설 전체 보기'}</summary><ExplanationText className="collection-explanation" text={text} emphasizeLead={emphasizeLead}/></details>{originalImageId && <ReviewOriginalExplanation imageId={originalImageId} multiline={originalMultiline}/>}</section>;
}

function originalExplanationProps(question: Question) {
  return question.book ? { originalImageId: question.book.reviewImageId, originalMultiline: question.explanation.split(/\r?\n/).length >= 4 } : {};
}

export function QuestionCollection({ questions, allQuestions, scheme, onBookmark, bookmarks, onEdit, reviewStates, onReport, reportedIds, reviewStreaks, empty, onEmptyAction }: { questions: Question[]; allQuestions: Question[]; scheme: SchemeId; onBookmark: (id: string) => void; bookmarks: string[]; onEdit: (question: Question) => void; reviewStates?: ReadonlyMap<string, ReviewState>; onReport?: (question: Question) => void; reportedIds?: ReadonlySet<string>; reviewStreaks?: ReadonlyMap<string, number>; empty?: { title: string; text: string; action?: string }; onEmptyAction?: () => void }) {
  if (!questions.length) return <EmptyState icon="check" title={empty?.title ?? '복습할 오답·미응답이 없어요'} text={empty?.text ?? '시험을 제출하면 오답과 미응답을 이곳에서 다시 풀 수 있습니다.'} action={empty?.action} onAction={onEmptyAction} actionIcon="play"/>;
  return <div className="collection-list">{questions.map((question, index) => <article className="collection-card" key={question.id}><div className="collection-number">{String(index + 1).padStart(2, '0')}</div><div className="collection-body"><div className="collection-meta"><span>{subjectFor(question, scheme) || question.originalSubject}</span>{reviewStates?.has(question.id) && <span className={`review-state ${reviewStates.get(question.id)}`}>{reviewStates.get(question.id) === 'unanswered' ? '미응답' : '오답'}</span>}{Boolean(reviewStreaks?.get(question.id)) && <span className="review-streak" title={`연속 ${REVIEW_GRADUATION_STREAK}번 맞히면 오답노트에서 빠집니다`}>연속 정답 {reviewStreaks!.get(question.id)}/{REVIEW_GRADUATION_STREAK}</span>}{(question.year || question.round) && <span>{question.year ? `${question.year}년 ` : ''}{question.round}</span>}</div><ReadableQuestion text={question.prompt} as="h3"/>{question.book ? <BookExamImage question={question}/> : question.imageDataUrl && <img className="question-image small" src={question.imageDataUrl} alt="문제 이미지"/>}<div className="collection-answer"><span>정답 {question.answer}번</span><span>{question.answer == null ? '정답 검수 필요' : question.choices[question.answer - 1]}</span></div>{(question.explanation || question.book) && <ReviewExplanation text={bookExplanationText(question, allQuestions)} {...originalExplanationProps(question)}/>}</div><div className="collection-tools"><button className={`icon-button ${bookmarks.includes(question.id) ? 'bookmarked' : ''}`} onClick={() => onBookmark(question.id)} aria-label="북마크"><Icon name="bookmark"/></button>{onReport && <button className={`icon-button ${reportedIds?.has(question.id) ? 'reported' : ''}`} onClick={() => onReport(question)} aria-haspopup="dialog" aria-label={reportedIds?.has(question.id) ? '오류 신고 수정' : '오류 신고'} title="오류 신고"><Icon name="warning"/></button>}<button className="icon-button" onClick={() => onEdit(question)} aria-label="문제 수정" title="지문·보기·해설 수정"><Icon name="edit"/></button></div></article>)}</div>;
}

function StatsPage({ questions, attempts: allAttempts, scheme, setScheme, onHistory }: { questions: Question[]; attempts: Attempt[]; scheme: SchemeId; setScheme: (scheme: SchemeId) => void; onHistory: () => void }) {
  const [period, setPeriod] = useState<StatsPeriod>('all');
  const attempts = attemptsInPeriod(allAttempts, period, Date.now());
  const periodLabel = STATS_PERIODS.find((item) => item.value === period)!.label;
  const map = new Map(questions.map((question) => [question.id, question]));
  let answered = 0; let correct = 0;
  for (const attempt of attempts) for (const [id, answer] of Object.entries(attempt.answers)) { const question = map.get(id); if (question) { answered++; if (answer === question.answer) correct++; } }
  return <section className="page-content stats-page"><PageHeading eyebrow="학습 분석" title="학습 통계" description="응시 결과를 바탕으로 현재 학습 상태와 취약 과목을 확인하세요." action={<button className="button outline" onClick={onHistory}>응시 이력 <Icon name="arrow" size={15}/></button>}/><div className="period-chips" role="group" aria-label="통계 기간">{STATS_PERIODS.map((item) => <button key={item.value} type="button" className={period === item.value ? 'active' : ''} aria-pressed={period === item.value} onClick={() => setPeriod(item.value)}>{item.label}</button>)}<span>{period === 'all' ? '제출한 모든 시험 기준' : `${periodLabel} 동안 제출한 시험 기준`}</span></div><div className="stats-overview"><div className="panel overall-score"><span className="eyebrow">전체 정답률</span><div className="overall-number">{answered ? Math.round(correct / answered * 100) : '—'}<small>{answered ? '%' : ''}</small></div><p>총 {answered}문제 응시 · {attempts.length}회 시험</p><div className="overall-track"><span style={{ width: `${answered ? correct / answered * 100 : 0}%` }}/></div></div><div className="panel stats-small"><span className="stats-small-icon blue"><Icon name="book"/></span><span>풀이한 문제</span><strong>{answered}</strong><small>{period === 'all' ? '누적 응답 수' : `${periodLabel} 응답 수`}</small></div><div className="panel stats-small"><span className="stats-small-icon orange"><Icon name="warning"/></span><span>응시한 시험</span><strong>{attempts.length}</strong><small>제출 완료 기준</small></div><div className="panel stats-small"><span className="stats-small-icon green"><Icon name="check"/></span><span>맞힌 문제</span><strong>{correct}</strong><small>전체 응답 중 정답</small></div></div><div className="panel stats-subject-panel"><div className="panel-heading"><div><span className="eyebrow">과목별 분석</span><h2>과목별 정답률과 취약 과목</h2></div><select className="mini-select" value={scheme} onChange={(event) => setScheme(event.target.value as SchemeId)}><option value="legacy">2024–2026 기준</option><option value="revised">2027–2029 기준</option></select></div><SubjectBars questions={questions} attempts={attempts} scheme={scheme} emptyTitle={period === 'all' ? undefined : `${periodLabel} 동안 제출한 시험이 없어요`} emptyText={period === 'all' ? undefined : '기간을 넓히거나 문제를 풀고 제출하면 여기에 표시됩니다.'}/><div className="stats-note"><Icon name="shield" size={16}/>과목 점수는 선택한 출제 기준에 따라 분류된 문제만 반영합니다. 개정 과목으로 재분류되지 않은 과거 문제는 2027 기준 통계에서 제외됩니다. 정답률 40% 미만 과목은 과락 위험으로 표시합니다.</div></div><div className="panel stats-history-panel"><div className="panel-heading"><div><span className="eyebrow">기록</span><h2>최근 응시 결과</h2></div><button className="text-button" onClick={onHistory}>전체 보기 <Icon name="arrow" size={14}/></button></div>{attempts.length ? attempts.slice(0, 3).map((attempt) => { const score = scoreAttempt(attempt, questions); return <div className="history-row" key={attempt.id}><span className="history-type-icon"><Icon name="book"/></span><div className="history-info"><strong>{attempt.title}</strong><small>{new Date(attempt.submittedAt).toLocaleString('ko-KR')} · {attempt.questionIds.length}문제</small></div><span className="history-result">{score.score}<small>점</small></span><span className={`history-badge ${score.fullExam ? score.passed ? 'pass' : 'fail' : 'practice'}`}>{score.fullExam ? score.passed ? '합격' : '불합격' : '연습'}</span></div> }) : <div className="empty-history">아직 응시 기록이 없습니다.</div>}</div></section>;
}

function HistoryPage({ attempts, questions, onBack }: { attempts: Attempt[]; questions: Question[]; onBack: () => void }) {
  return <section className="page-content"><PageHeading eyebrow="기록" title="응시 이력" description="완료한 모의시험의 결과를 확인할 수 있습니다." action={<button className="button outline" onClick={onBack}><Icon name="left"/>통계로 돌아가기</button>}/><div className="panel history-full-list">{attempts.length ? attempts.map((attempt) => { const score = scoreAttempt(attempt, questions); return <div className="history-row" key={attempt.id}><span className="history-type-icon"><Icon name="book"/></span><div className="history-info"><strong>{attempt.title}</strong><small>{new Date(attempt.submittedAt).toLocaleString('ko-KR')} · {attempt.questionIds.length}문제 · 응답 {score.answered}</small></div><span className="history-result">{score.score}<small>점</small></span><span className={`history-badge ${score.fullExam ? score.passed ? 'pass' : 'fail' : 'practice'}`}>{score.fullExam ? score.passed ? '합격' : '불합격' : '연습'}</span></div> }) : <EmptyState icon="clock" title="응시 이력이 없습니다" text="모의시험을 완료하면 결과가 저장됩니다."/>}</div></section>;
}

function BankRow({ question, eligible, symbolReview = false, onEdit, onVerify, onDelete }: { question: Question; eligible: boolean; symbolReview?: boolean; onEdit: () => void; onVerify: () => void; onDelete: () => void }) {
  const rawVerifiedButBlocked = question.status === 'verified' && !eligible;
  return <article className="bank-row"><div className="bank-row-main"><div className="bank-row-top"><span className={`status-pill ${eligible ? 'verified' : 'pending'}`}>{eligible ? question.book?.review?.ai ? 'AI 원본 대조 승인' : question.book?.review?.automatic ? '자동 검사 승인' : '검수 완료' : rawVerifiedButBlocked ? '승인 조건 미충족 · 출제 제외' : '검수 대기'}</span>{question.duplicateOf && <span className="duplicate-pill"><Icon name="warning" size={13}/>중복 의심</span>}{symbolReview && <span className="duplicate-pill symbol-pill"><Icon name="warning" size={13}/>기호·오탈자 확인 필요</span>}{(question.year || question.round) && <span className="bank-source">{question.year ? `${question.year}년 ` : ""}{question.round}</span>}<span className="bank-source">{subjectFor(question, 'legacy') || question.originalSubject}</span>{question.book && <span className="bank-source">{question.book.originalId} · 책 {question.book.originalNumber}번{question.year === null ? ' · 연도 미상' : ''}</span>}{question.currentSubject && question.currentSubject !== question.originalSubject && <span className="reclass-tag">개정 분류 완료</span>}</div><h3>{question.prompt}</h3><div className="bank-row-bottom"><span>정답 {question.answer}번</span><span>{question.answer == null ? '정답 검수 필요' : question.choices[question.answer - 1]}</span><span>{question.source ? `${question.source}${question.sourcePage ? ` · ${question.sourcePage}쪽` : ''}` : '출처 미기재'}</span></div>{!question.book && question.imageDataUrl && <img className="bank-thumb" src={question.imageDataUrl} alt="문항 첨부 이미지"/>}</div><div className="bank-row-actions"><button className="icon-button" onClick={onEdit} aria-label="문항 수정" title="지문·보기·해설 수정"><Icon name="edit"/></button>{!eligible && <button className="verify-button" onClick={onVerify}><Icon name="check" size={15}/>{question.book ? '원본 대조 검수' : '검수 확인'}</button>}<button className="icon-button danger" onClick={onDelete} aria-label="삭제"><Icon name="trash"/></button></div></article>;
}

function QuestionEditor({ question, onClose, onSave }: { question?: Question; onClose: () => void; onSave: (question: Question) => void }) {
  const [year, setYear] = useState(question?.year == null ? '' : String(question.year));
  const [round, setRound] = useState(question?.round ?? '');
  const [originalSubject, setOriginalSubject] = useState(canonicalSubjectLabel(question?.originalSubject) ?? SUBJECTS.legacy[0]);
  const [currentSubject, setCurrentSubject] = useState(canonicalSubjectLabel(question?.currentSubject, 'revised') ?? '');
  const [prompt, setPrompt] = useState(question?.prompt ?? '');
  const [choices, setChoices] = useState<string[]>(question?.choices ?? ['', '', '', '']);
  const [answer, setAnswer] = useState<number | null>(question?.answer ?? null);
  const [explanation, setExplanation] = useState(question?.explanation ?? '');
  const [source, setSource] = useState(question?.source ?? '');
  const [sourcePage, setSourcePage] = useState(question?.sourcePage ? String(question.sourcePage) : '');
  const [imageDataUrl, setImageDataUrl] = useState(question?.imageDataUrl ?? '');
  const [error, setError] = useState('');
  const form = useRef<HTMLFormElement>(null);
  const dirty = prompt !== (question?.prompt ?? '') || explanation !== (question?.explanation ?? '') || choices.join('\u0000') !== (question?.choices ?? ['', '', '', '']).join('\u0000')
    || answer !== (question?.answer ?? null) || year !== (question?.year == null ? '' : String(question.year)) || round !== (question?.round ?? '')
    || source !== (question?.source ?? '') || sourcePage !== (question?.sourcePage ? String(question.sourcePage) : '') || imageDataUrl !== (question?.imageDataUrl ?? '');
  function requestClose() {
    if (dirty && !window.confirm('저장하지 않은 수정 내용이 있습니다. 저장하지 않고 닫을까요?')) return;
    onClose();
  }
  const closeHandler = useRef(requestClose);
  closeHandler.current = requestClose;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.isComposing) { event.preventDefault(); closeHandler.current(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  async function onImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('문제 이미지는 PNG, JPG 등 이미지 파일만 첨부할 수 있습니다.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('이미지는 5MB 이하로 선택해 주세요.'); return; }
    const reader = new FileReader();
    reader.onload = () => setImageDataUrl(String(reader.result));
    reader.readAsDataURL(file);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() || choices.some((choice) => !choice.trim()) || !explanation.trim()) { setError('문제, 보기 4개, 해설을 모두 입력해 주세요.'); return; }
    if (answer === null || !Number.isInteger(answer) || answer < 1 || answer > 4) { setError('원본을 대조한 정답 번호를 직접 선택해 주세요.'); return; }
    const yearNumber = year.trim() ? Number(year) : null;
    if (yearNumber !== null && (!Number.isInteger(yearNumber) || yearNumber < 1900 || yearNumber > 2099)) { setError('연도를 확인해 주세요.'); return; }
    const item: Question = {
      ...question,
      id: question?.id ?? makeId(), year: yearNumber, round: round.trim(), originalSubject, currentSubject: currentSubject || undefined,
      prompt: prompt.trim(), choices: choices.map((choice) => choice.trim()), answer, explanation: explanation.trim(), status: 'pending',
      source: source.trim() || undefined, sourcePage: sourcePage ? Number(sourcePage) : undefined, imageDataUrl: imageDataUrl || undefined, createdAt: question?.createdAt ?? new Date().toISOString(),
    };
    onSave(item);
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}><section className="editor-modal" role="dialog" aria-modal="true" aria-labelledby="editor-title"><div className="editor-header"><div><span className="eyebrow">문제 검수</span><h2 id="editor-title">{question ? '문제 수정 및 재검수' : '새 문제 추가'}</h2></div><button className="icon-button" onClick={requestClose} aria-label="닫기"><Icon name="close"/></button></div><div className="editor-callout"><Icon name="shield" size={17}/><p>저장 후 <strong>검수 대기</strong>로 등록됩니다. 답과 해설을 확인한 뒤 검수 완료를 눌러주세요.</p></div><form onSubmit={submit} className="editor-form" ref={form}><div className="editor-grid three"><label>연도 <span className="optional">선택</span><input type="number" min="1900" max="2099" value={year} onChange={(event) => setYear(event.target.value)} placeholder="연도 미분류"/></label><label>회차 <span className="optional">선택</span><input value={round} onChange={(event) => setRound(event.target.value)} placeholder="회차 미분류"/></label><label>출처 쪽수<input type="number" min="1" value={sourcePage} onChange={(event) => setSourcePage(event.target.value)} placeholder="선택 사항"/></label></div><label>원본 과목 <span className="required">필수</span><select value={originalSubject} onChange={(event) => setOriginalSubject(event.target.value)}>{SUBJECTS.legacy.map((subject) => <option key={subject}>{subject}</option>)}</select><small>기출 당시의 과목을 보존합니다.</small></label><label>2027 개정 과목 <span className="optional">재분류 완료 시 입력</span><select value={currentSubject} onChange={(event) => setCurrentSubject(event.target.value)}><option value="">미분류 · 개정 시험에 미출제</option>{SUBJECTS.revised.map((subject) => <option key={subject}>{subject}</option>)}</select><small>공식 개정 과목 기준으로 확인한 경우에만 선택하세요.</small></label><SymbolPalette scope={form}/><SymbolHintList hints={symbolHints({ prompt, choices, explanation })}/><label>문제 내용 <span className="required">필수</span><textarea rows={3} data-symbol-field="문제 내용" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="문제 내용을 입력하세요."/></label><div className="choices-editor"><span className="editor-label">보기 <span className="required">4개 필수</span></span>{choices.map((choice, index) => <label className="choice-input" key={index}><span>{index + 1}</span><textarea rows={1} data-symbol-field={`보기 ${index + 1}`} aria-label={`보기 ${index + 1} 내용`} value={choice} onChange={(event) => setChoices((items) => items.map((item, i) => i === index ? event.target.value : item))} placeholder={`${index + 1}번 보기`}/><input className="answer-radio" type="radio" name="answer" checked={answer === index + 1} onChange={() => setAnswer(index + 1)} aria-label={`${index + 1}번 정답 선택`}/></label>)}</div><label>해설 <span className="required">필수</span><textarea rows={3} data-symbol-field="해설" value={explanation} onChange={(event) => setExplanation(event.target.value)} placeholder="정답 근거와 풀이를 입력하세요."/></label><div className="editor-grid"><label>자료 출처<input value={source} onChange={(event) => setSource(event.target.value)} placeholder="예: 산업안전기사 필기 기출문제집"/></label><label>문제 이미지 <span className="optional">5MB 이하</span><input type="file" accept="image/*" onChange={(event) => void onImage(event)}/></label></div>{imageDataUrl && <div className="image-preview"><img src={imageDataUrl} alt="첨부한 문제"/><button type="button" className="icon-button danger" onClick={() => setImageDataUrl('')}><Icon name="trash"/></button></div>}{error && <p className="form-error" role="alert">{error}</p>}<div className="editor-footer"><button type="button" className="button outline" onClick={requestClose}>취소</button><button className="button primary" type="submit">검수 대기로 저장 <Icon name="arrow" size={16}/></button></div></form></section></div>;
}

/** Confirm before leaving a running set. States what is kept and that the timer keeps running; no guilt-trip copy. */
export function ExitConfirmSheet({ session, remaining, onStay, onLeave }: { session: ActiveSession; remaining: number; onStay: () => void; onLeave: () => void }) {
  const stayRef = useRef<HTMLButtonElement>(null);
  const stayCallback = useRef(onStay);
  stayCallback.current = onStay;
  useEffect(() => {
    stayRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); stayCallback.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  const answered = Object.keys(session.answers).length;
  const total = session.questionIds.length;
  return <div className="modal-backdrop sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onStay(); }}>
    <section className="report-sheet exit-sheet" role="alertdialog" aria-modal="true" aria-labelledby="exit-title" aria-describedby="exit-detail" onKeyDown={(event) => event.stopPropagation()}>
      <span className="sheet-handle" aria-hidden="true"/>
      <h2 id="exit-title">학습을 잠시 나갈까요?</h2>
      <div className="exit-progress" aria-hidden="true"><span style={{ width: `${total ? answered / total * 100 : 0}%` }}/></div>
      <ul id="exit-detail" className="exit-facts">
        <li><strong>{total}문항 중 {answered}문항</strong>에 답했고, 답안은 이 기기에 저장되어 있습니다.</li>
        <li>대시보드의 <strong>진행 중</strong> 배너에서 이어 풀 수 있습니다.</li>
        <li>남은 시간 <strong>{formatClock(remaining)}</strong>은 나가 있는 동안에도 줄어들고, 0이 되면 자동으로 제출됩니다.</li>
      </ul>
      <div className="editor-footer"><button type="button" className="button outline" onClick={onLeave}>나가기</button><button type="button" ref={stayRef} className="button primary" onClick={onStay}>계속 풀기</button></div>
    </section>
  </div>;
}

function questionLabel(question: Question): string {
  const subject = question.currentSubject || question.originalSubject;
  const number = question.book?.originalNumber;
  return [subject, number != null ? `${number}번` : '', question.book?.originalId ?? ''].filter(Boolean).join(' · ');
}

/** Bottom sheet for reporting a question error. Shows the question text only; never the answer or the answer-bearing review image. */
export function ErrorReportSheet({ question, existing, onClose, onSave }: { question: Question; existing?: ErrorReport; onClose: () => void; onSave: (fields: ErrorReportField[], note: string) => Promise<void> | void }) {
  const [fields, setFields] = useState<ErrorReportField[]>(existing?.fields ?? []);
  const [note, setNote] = useState(existing?.note ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    noteRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); closeRef.current(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  function toggle(field: ErrorReportField) {
    setError('');
    setFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field]);
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const problem = errorReportInputError(fields, note);
    if (problem) { setError(problem); return; }
    setSaving(true);
    try { await onSave(fields, note); } catch { setError('저장하지 못했습니다. 다시 시도해 주세요.'); setSaving(false); }
  }
  const excerpt = question.prompt.replace(/\s+/g, ' ').trim();
  return <div className="modal-backdrop sheet-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="report-sheet" role="dialog" aria-modal="true" aria-labelledby="report-title" aria-describedby="report-target" onKeyDown={(event) => event.stopPropagation()}>
      <span className="sheet-handle" aria-hidden="true"/>
      <div className="editor-header"><div><span className="eyebrow">문제 오류 신고</span><h2 id="report-title">{existing ? '신고 내용 수정' : '어디가 잘못됐나요?'}</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="닫기"><Icon name="close"/></button></div>
      <div className="report-target" id="report-target"><strong>{questionLabel(question)}</strong><p>{excerpt.length > 90 ? `${excerpt.slice(0, 90)}…` : excerpt}</p></div>
      <form onSubmit={submit} className="report-form">
        <fieldset className="report-fields"><legend>오류 위치 <span className="optional">여러 개 선택 가능</span></legend>
          <div>{ERROR_REPORT_FIELDS.map((field) => <button type="button" key={field.value} className={`report-chip ${fields.includes(field.value) ? 'selected' : ''}`} aria-pressed={fields.includes(field.value)} onClick={() => toggle(field.value)}>{fields.includes(field.value) && <Icon name="check" size={13}/>}{field.label}</button>)}</div>
        </fieldset>
        <label className="report-note">내용 <span className="optional">원본과 다른 글자, 빠진 기호 등</span>
          <textarea ref={noteRef} value={note} maxLength={ERROR_REPORT_NOTE_LIMIT} rows={4} placeholder="예: 보기 ③의 '□'가 'ㅁ'으로 보입니다." onChange={(event) => { setNote(event.target.value); setError(''); }}/>
          <small className="report-count" aria-live="polite">{note.length} / {ERROR_REPORT_NOTE_LIMIT}자</small>
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <p className="report-hint">신고는 이 기기의 학습기록에 저장되고, 기기 이전·전체 백업에 함께 담깁니다. 문제 내용은 바뀌지 않습니다.</p>
        <div className="editor-footer"><button type="button" className="button outline" onClick={onClose}>취소</button><button type="submit" className="button primary" disabled={saving}>{saving ? '저장 중…' : existing ? '수정 저장' : '신고 저장'}</button></div>
      </form>
    </section>
  </div>;
}

export function ErrorReportPanel({ reports, questions, onStatus, onDelete, onExport }: { reports: ErrorReport[]; questions: Question[]; onStatus: (id: string, status: ErrorReport['status']) => void; onDelete: (id: string) => void; onExport: () => void }) {
  const [showResolved, setShowResolved] = useState(false);
  const byId = useMemo(() => new Map(questions.map((question) => [question.id, question])), [questions]);
  const open = reports.filter((report) => report.status === 'open');
  const visible = [...(showResolved ? reports : open)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return <section className="report-panel" aria-labelledby="report-panel-title">
    <header><div><h2 id="report-panel-title"><Icon name="warning" size={16}/>오류 신고</h2><span>처리 전 <strong>{open.length}</strong>건 · 전체 {reports.length}건</span></div><div className="report-panel-actions"><label className="report-toggle"><input type="checkbox" checked={showResolved} onChange={(event) => setShowResolved(event.target.checked)}/>처리 완료 포함</label><button className="button outline" onClick={onExport}><Icon name="download" size={15}/>JSON 내보내기</button></div></header>
    {visible.length ? <ul className="report-list">{visible.map((report) => {
      const question = byId.get(report.questionId);
      return <li key={report.id} className={report.status === 'resolved' ? 'resolved' : ''}>
        <div className="report-item-head"><strong>{question ? questionLabel(question) : `삭제된 문항 · ${report.originalId ?? report.questionId}`}</strong><time dateTime={report.updatedAt}>{report.updatedAt.slice(0, 10)}</time></div>
        {report.fields.length > 0 && <div className="report-item-fields">{report.fields.map((field) => <span key={field}>{errorReportFieldLabel(field)}</span>)}</div>}
        {report.note && <p>{report.note}</p>}
        <div className="report-item-actions">{report.status === 'open' ? <button className="text-button" onClick={() => onStatus(report.id, 'resolved')}><Icon name="check" size={14}/>처리 완료</button> : <button className="text-button" onClick={() => onStatus(report.id, 'open')}>다시 열기</button>}<button className="text-button danger-text" onClick={() => onDelete(report.id)}><Icon name="trash" size={14}/>삭제</button></div>
      </li>;
    })}</ul> : <p className="report-empty">처리할 신고가 없습니다.</p>}
  </section>;
}

function EmptyState({ icon, title, text, action, onAction, actionIcon = 'plus' }: { icon: string; title: string; text: string; action?: string; onAction?: () => void; actionIcon?: string }) {
  return <div className="empty-state"><span className="empty-state-icon"><Icon name={icon} size={25}/></span><h2>{title}</h2><p>{text}</p>{action && onAction && <button className="button primary" onClick={onAction}><Icon name={actionIcon} size={16}/>{action}</button>}</div>;
}
