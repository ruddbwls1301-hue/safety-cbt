import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { latestReviewItems, latestWrongIds, QuestionCollection, scoreAttempt } from '../App';
import { getQuestions, getUserData, saveUserData } from './db';
import type { Attempt, Question, UserData } from '../types';

// Isolated synthetic fixtures, never imported into a real question bank.
const questions: Question[] = Array.from({ length: 20 }, (_, index) => ({
  id: `review-unit-${index + 1}`, year: null, round: '', originalSubject: '산업재해 예방 및 안전보건교육',
  prompt: `합성 복습 검증 ${index + 1}`, choices: ['가', '나', '다', '라'], answer: 2,
  explanation: '합성 검증용 해설', status: 'verified', createdAt: '2026-10-12T00:00:00Z',
}));
function attempt(answers: Record<string, number>, overrides: Partial<Attempt> = {}): Attempt {
  return { id: 'review-unit-attempt', title: '합성 복습 검증', scheme: 'legacy', mode: 'subject',
    questionIds: questions.map((q) => q.id), answers, startedAt: '2026-10-12T00:00:00Z',
    submittedAt: '2026-10-12T00:01:00Z', remainingSeconds: 10, feedbackEnabled: true, ...overrides };
}
const allAnswers = (answer: number) => Object.fromEntries(questions.map((q) => [q.id, answer]));

describe('wrong and unanswered review states', () => {
  it('includes only actual wrong responses when every question was answered', () => {
    const answers = allAnswers(2); answers[questions[0].id] = 1; answers[questions[1].id] = 4;
    const entries = latestReviewItems([attempt(answers)], questions);
    expect(entries).toEqual(questions.slice(0, 2).map((q) => ({ questionId: q.id, state: 'wrong' })));
    expect(latestWrongIds([attempt(answers)], questions)).toEqual(questions.slice(0, 2).map((q) => q.id));
  });
  it('includes unanswered questions without turning them into actual wrong responses', () => {
    const answers = allAnswers(2); delete answers[questions[0].id];
    expect(latestReviewItems([attempt(answers)], questions)).toEqual([{ questionId: questions[0].id, state: 'unanswered' }]);
    expect(latestWrongIds([attempt(answers)], questions)).toEqual([]);
    expect(Object.keys(answers)).toHaveLength(19);
  });
  it('retains one wrong and eighteen unanswered questions with the existing five-point score', () => {
    const entry = attempt({ [questions[0].id]: 1, [questions[1].id]: 2 });
    const before = structuredClone(entry);
    const reviews = latestReviewItems([entry], questions);
    expect(reviews).toHaveLength(19);
    expect(reviews.filter((r) => r.state === 'wrong')).toEqual([{ questionId: questions[0].id, state: 'wrong' }]);
    expect(reviews.filter((r) => r.state === 'unanswered')).toHaveLength(18);
    expect(new Set(reviews.map((r) => r.questionId)).size).toBe(19);
    expect(latestWrongIds([entry], questions)).toEqual([questions[0].id]);
    expect(scoreAttempt(entry, questions)).toMatchObject({ correct: 1, answered: 2, total: 20, score: 5 });
    expect(entry).toEqual(before);
  });
  it('has no review targets when all twenty responses are correct', () => {
    const entry = attempt(allAnswers(2));
    expect(latestReviewItems([entry], questions)).toEqual([]);
    expect(latestWrongIds([entry], questions)).toEqual([]);
    expect(scoreAttempt(entry, questions)).toMatchObject({ correct: 20, answered: 20, score: 100 });
  });
  it('retains all twenty unanswered questions without adding fake answers or wrong responses', () => {
    const entry = attempt({});
    expect(latestReviewItems([entry], questions)).toEqual(questions.map((q) => ({ questionId: q.id, state: 'unanswered' })));
    expect(latestWrongIds([entry], questions)).toEqual([]);
    expect(scoreAttempt(entry, questions)).toMatchObject({ correct: 0, answered: 0, total: 20, score: 0 });
    expect(entry.answers).toEqual({});
  });
  it('uses each question’s latest submission without duplicate rows or losing older history', () => {
    const old = attempt(allAnswers(1), { id: 'old', submittedAt: '2026-10-11T00:00:00Z' });
    const newest = attempt({ [questions[0].id]: 2 }, { id: 'new', questionIds: [questions[0].id, questions[1].id] });
    const before = structuredClone([newest, old]);
    const reviews = latestReviewItems([newest, old], questions);
    expect(reviews).not.toContainEqual(expect.objectContaining({ questionId: questions[0].id }));
    expect(reviews.find((r) => r.questionId === questions[1].id)?.state).toBe('unanswered');
    expect(reviews.filter((r) => r.state === 'wrong')).toHaveLength(18);
    expect(new Set(reviews.map((r) => r.questionId)).size).toBe(19);
    expect(latestReviewItems([old, newest], questions)).toEqual(reviews);
    expect([newest, old]).toEqual(before);
  });
  it('keeps the newest-first history order for identical submission timestamps', () => {
    const older = attempt(allAnswers(1), { id: 'older' });
    const newer = attempt(allAnswers(2), { id: 'newer' });
    expect(latestReviewItems([newer, older], questions)).toEqual([]);
  });
  it('deduplicates stored question IDs and ignores answers outside the submitted selection', () => {
    const entry = attempt({ [questions[1].id]: 1 }, { questionIds: [questions[0].id, questions[0].id, 'missing-bank-id'] });
    expect(latestReviewItems([entry, entry], questions)).toEqual([{ questionId: questions[0].id, state: 'unanswered' }]);
    expect(latestWrongIds([entry], questions)).toEqual([]);
  });
  it('shows distinct wrong and unanswered labels in the same review list', () => {
    const html = renderToStaticMarkup(<QuestionCollection questions={questions.slice(0, 2)} allQuestions={questions}
      scheme="legacy" bookmarks={[questions[0].id]} onBookmark={() => {}} onEdit={() => {}}
      reviewStates={new Map([[questions[0].id, 'wrong'], [questions[1].id, 'unanswered']])}/>);
    expect(html).toContain('class="review-state wrong">오답');
    expect(html).toContain('class="review-state unanswered">미응답');
    expect(html.match(/class="collection-card"/g)).toHaveLength(2);
    expect(html).toContain('icon-button bookmarked');
  });
});

describe('review records after a storage reload', () => {
  it('derives the same nineteen targets from persisted history without changing version, stores, question IDs or bookmarks', async () => {
    const request = indexedDB.open('industrial-safety-cbt', 4);
    const stores = [['questionBank', 'id'], ['userData', 'key'], ['pdfSources', 'id'], ['pdfFiles', 'id'], ['pdfDrafts', 'id'], ['pdfPageTexts', 'id'], ['bookImages', 'id'], ['bookImports', 'importId']];
    request.onupgradeneeded = () => stores.forEach(([name, keyPath]) => request.result.createObjectStore(name, { keyPath }));
    const db = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    const old = attempt(allAnswers(2), { id: 'preserved-old', submittedAt: '2026-10-11T00:00:00Z' });
    const latest = attempt({ [questions[0].id]: 1, [questions[1].id]: 2 });
    const user: UserData = { key: 'state', attempts: [latest, old], bookmarks: [questions[0].id], theme: 'dark' };
    const tx = db.transaction(['questionBank', 'bookImages'], 'readwrite');
    questions.forEach((q) => tx.objectStore('questionBank').add(q));
    tx.objectStore('bookImages').add({ id: 'preserved-image', kind: 'review', blob: new Blob(['synthetic-fixture']), createdAt: old.startedAt });
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); });
    await saveUserData(user);
    const restored = await getUserData();
    expect(restored).toEqual(user);
    expect(restored.attempts[0].answers).toEqual({ [questions[0].id]: 1, [questions[1].id]: 2 });
    expect(latestReviewItems(restored.attempts, await getQuestions())).toHaveLength(19);
    expect(latestWrongIds(restored.attempts, questions)).toEqual([questions[0].id]);
    expect(restored.bookmarks).toEqual(user.bookmarks);
    const byId = (left: Question, right: Question) => left.id.localeCompare(right.id);
    expect((await getQuestions()).sort(byId)).toEqual([...questions].sort(byId));
    expect(db.version).toBe(4);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(stores.map(([name]) => name).sort());
    const imageCount = db.transaction('bookImages', 'readonly').objectStore('bookImages').count();
    expect(await new Promise<number>((resolve) => { imageCount.onsuccess = () => resolve(imageCount.result); })).toBe(1);
    db.close();
  });
});
