import { describe, expect, it } from 'vitest';
import { activateStudySession } from './studySessions';
import type { ActiveSession, UserData } from '../types';

const unitSession = (id: string): ActiveSession => ({ id, title: '합성 테스트용 학습', scheme: 'legacy', mode: 'subject', questionIds: [id], answers: { [id]: 2 }, markedIds: [id], index: 0, startedAt: '2026-01-01T00:00:00Z', deadlineAt: 10000, feedbackEnabled: true, checkedQuestionIds: [id] });
describe('unfinished study preservation', () => {
  it('keeps prior answers, checked state, bookmarks and history when starting a new 20-question set', () => {
    const previous = unitSession('unit-previous');
    const user: UserData = { key: 'state', attempts: [], bookmarks: ['unit-bookmark'], theme: 'dark', activeSession: previous };
    const result = activateStudySession(user, unitSession('unit-next'), 5000);
    expect(result.activeSession?.id).toBe('unit-next');
    expect(result.savedSessions).toEqual([{ ...previous, pausedAt: 5000 }]);
    expect(result.attempts).toBe(user.attempts);
    expect(result.bookmarks).toBe(user.bookmarks);
    expect(user.activeSession).toBe(previous);
    expect(previous.pausedAt).toBeUndefined();
  });
  it('restores paused time and swaps sessions without duplicates or record deletion', () => {
    const target = { ...unitSession('unit-saved'), pausedAt: 5000 };
    const current = unitSession('unit-current');
    const user: UserData = { key: 'state', attempts: [], bookmarks: [], theme: 'light', activeSession: current, savedSessions: [target, unitSession('unit-other')] };
    const result = activateStudySession(user, target, 8000);
    expect(result.activeSession).toEqual({ ...target, pausedAt: undefined, deadlineAt: 13000 });
    expect(result.savedSessions?.map((saved) => saved.id)).toEqual(['unit-current', 'unit-other']);
    expect(target.deadlineAt).toBe(10000);
    expect(user.savedSessions).toHaveLength(2);
  });
});
