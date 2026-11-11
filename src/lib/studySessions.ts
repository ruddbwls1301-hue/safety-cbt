import type { ActiveSession, UserData } from '../types';

/** Switch sessions while preserving unfinished work and all prior learning records. */
export function activateStudySession(user: UserData, next: ActiveSession, now: number): UserData {
  const savedSessions = (user.savedSessions ?? []).filter((saved) => saved.id !== next.id && saved.id !== user.activeSession?.id);
  if (user.activeSession && user.activeSession.id !== next.id) savedSessions.unshift({ ...user.activeSession, pausedAt: user.activeSession.pausedAt ?? now });
  const activeSession = next.pausedAt === undefined ? next : { ...next, deadlineAt: next.deadlineAt + Math.max(0, now - next.pausedAt), pausedAt: undefined };
  return { ...user, activeSession, savedSessions };
}
