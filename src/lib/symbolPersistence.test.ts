import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import type { Question, UserData } from '../types';

// Synthetic data in an in-memory fake IndexedDB; the real browser database is never opened.
const SYMBOLS = '○ ⇒ □ ◇ ▽ D';
const original: Question = {
  id: 'unit-persist-symbol', year: null, round: '', originalSubject: '인간공학 및 위험성 평가·관리',
  prompt: '합성 지문: 기호와 의미가 잘못 연결된 것은?', choices: ['0 : 지체', 'V : 저장', '5: 운반', '0: 가공'], answer: 1,
  explanation: '합성 해설', status: 'verified', createdAt: '2026-01-01T00:00:00.000Z',
};
const user: UserData = {
  key: 'state', theme: 'light', bookmarks: [original.id],
  attempts: [{ id: 'unit-attempt', title: '합성 응시', scheme: 'legacy', mode: 'subject', questionIds: [original.id], answers: { [original.id]: 4 }, startedAt: '2026-01-02T00:00:00.000Z', submittedAt: '2026-01-02T00:05:00.000Z', remainingSeconds: 60 }],
  activeSession: { id: 'unit-active', title: '합성 진행', scheme: 'legacy', mode: 'subject', questionIds: [original.id], answers: { [original.id]: 4 }, markedIds: [], index: 0, startedAt: '2026-01-03T00:00:00.000Z', deadlineAt: 1_900_000_000_000 },
};
/** A fresh module instance drops the cached connection, like a page reload. */
async function reload() { vi.resetModules(); return import('./db'); }

describe('symbol correction persistence', () => {
  it('stores corrected symbols byte-for-byte under the same ID and keeps attempt links after reload', async () => {
    let db = await reload();
    await db.saveQuestion(original);
    await db.saveUserData(user);

    const corrected: Question = {
      ...original, status: 'pending',
      prompt: `합성 지문: 기호(${SYMBOLS})와 의미가 잘못 연결된 것은?`,
      choices: ['□ : 지체', '▽ : 저장', '⇒ : 운반', '○ : 가공'],
      explanation: '합성 해설\n가공 ○ / 운반 ⇒ / 수량검사 □ / 품질검사 ◇ / 저장 ▽ / 지체 D\n10⁻³, ㎡, ≤',
    };
    await db.saveQuestion(corrected);

    db = await reload();
    const bank = await db.getQuestions();
    expect(bank).toHaveLength(1);
    expect(bank[0]).toEqual(corrected);
    expect(bank[0].id).toBe(original.id);
    expect(bank[0].status).toBe('pending');
    expect([...bank[0].choices.map((choice) => choice.codePointAt(0))]).toEqual([0x25a1, 0x25bd, 0x21d2, 0x25cb]);
    expect(bank[0].explanation.normalize('NFC')).toBe(corrected.explanation);
    expect(bank[0].explanation).toContain('◇');
    expect(bank[0].explanation.split('\n')).toHaveLength(3);

    const saved = await db.getUserData();
    expect(saved.attempts).toEqual(user.attempts);
    expect(saved.bookmarks).toEqual([original.id]);
    expect(saved.activeSession?.answers[original.id]).toBe(4);
  });

  it('survives the JSON backup round trip without altering symbols', async () => {
    const db = await reload();
    const [stored] = await db.getQuestions();
    const { parseQuestionBackup } = await import('./questions');
    const [restored] = parseQuestionBackup(JSON.parse(JSON.stringify([stored])));
    expect(restored.prompt).toBe(stored.prompt);
    expect(restored.choices).toEqual(stored.choices);
    expect(restored.explanation).toBe(stored.explanation);
    expect(restored.id).toBe(stored.id);
  });
});
