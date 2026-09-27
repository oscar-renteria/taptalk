import type { DashboardSummary, PracticeDirection, UserPreferences } from '@taptalk/shared';
import { recentAttemptWindow, type SelectionCandidate } from './selection.js';
import type {
  PracticeSessionRecord,
  PracticeSessionStatus,
  PracticeSessionSummary,
  VocabularyRecord,
} from './repositories.js';

// Guest data lives here, in process memory, and nowhere else. This module has no
// database handle at all: it cannot write to SQLite even by accident, which is
// what makes "a guest never persists anything" structural rather than a rule
// someone has to remember.
//
// The functions mirror the repository signatures they stand in for (see
// repositories.ts) so route handlers stay shared between actors. Scoring,
// matching, and question selection are not duplicated: they live in learning.ts,
// matching.ts, and selection.ts and are used by both actors.

export type GuestAttempt = {
  id: string;
  vocabularyEntryId: string;
  direction: Exclude<PracticeDirection, 'random'>;
  prompt: string;
  submittedAnswer: string;
  normalizedAnswer: string;
  correct: boolean;
  scoreDelta: number;
  matchingReason: string;
  attemptedAt: string;
  practiceSessionId: string | null;
};

type GuestSession = PracticeSessionRecord & { attempts: GuestAttempt[] };

type GuestData = {
  preferences: UserPreferences;
  sessions: Map<string, GuestSession>;
  attempts: GuestAttempt[];
};

const defaultPreferences: UserPreferences = {
  direction: 'random',
  sessionLength: 10,
  repetitionPreference: 'balanced',
};

// Bounded so a long-running server cannot grow without limit. Evicting costs a
// guest their in-flight round; it never affects a real user.
const maxGuests = 5_000;
const guests = new Map<string, GuestData>();

function dataFor(guestId: string): GuestData {
  const existing = guests.get(guestId);
  if (existing) return existing;
  const data: GuestData = {
    preferences: { ...defaultPreferences },
    sessions: new Map(),
    attempts: [],
  };
  guests.set(guestId, data);
  while (guests.size > maxGuests) {
    const oldest = guests.keys().next();
    if (oldest.done) break;
    guests.delete(oldest.value);
  }
  return data;
}

/** Drops everything held for a guest. Used when a guest session ends. */
export function forgetGuest(guestId: string): void {
  guests.delete(guestId);
}

/** Test helper: clears all in-memory guest state. */
export function resetGuestStore(): void {
  guests.clear();
}

/**
 * Read-only vocabulary lookup. The caller supplies the entries it already has,
 * so this module keeps no database dependency of its own.
 */
export type VocabularySource = () => VocabularyRecord[];

export function getPreferences(guestId: string): UserPreferences {
  return dataFor(guestId).preferences;
}

export function updatePreferences(guestId: string, preferences: UserPreferences): UserPreferences {
  dataFor(guestId).preferences = preferences;
  return preferences;
}

export function recordAttempt(guestId: string, attempt: GuestAttempt): void {
  const data = dataFor(guestId);
  data.attempts.push(attempt);
  // Also attached to its round, so per-session counts, summaries, and the
  // errors-first bias all read the same in-memory history a user reads from SQL.
  if (attempt.practiceSessionId) {
    data.sessions.get(attempt.practiceSessionId)?.attempts.push(attempt);
  }
}

// The in-memory attempt list is internal; callers only ever see the record shape
// the persisted session has, so no guest internals leak through the API.
function publicSession(session: GuestSession): PracticeSessionRecord {
  return {
    id: session.id,
    userId: session.userId,
    direction: session.direction,
    questionCount: session.questionCount,
    status: session.status,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    answeredCount: session.answeredCount,
  };
}

export function startPracticeSession(
  guestId: string,
  session: { id: string; direction: PracticeDirection; questionCount: number },
  now: string,
): PracticeSessionRecord {
  const data = dataFor(guestId);
  // Same policy as a user: one active session per identity, older ones abandoned.
  for (const existing of data.sessions.values()) {
    if (existing.status === 'active') {
      existing.status = 'abandoned';
      existing.endedAt = now;
    }
  }
  const record: GuestSession = {
    id: session.id,
    // Present so the record matches the persisted shape. It is never written
    // anywhere: there is no row behind this id.
    userId: guestId,
    direction: session.direction,
    questionCount: session.questionCount,
    status: 'active',
    startedAt: now,
    endedAt: null,
    answeredCount: 0,
    attempts: [],
  };
  data.sessions.set(session.id, record);
  return publicSession(record);
}

export function getPracticeSession(
  guestId: string,
  sessionId: string,
): PracticeSessionRecord | undefined {
  const session = dataFor(guestId).sessions.get(sessionId);
  return session ? publicSession(session) : undefined;
}

export function getSelectionCandidates(
  guestId: string,
  sessionId: string | null,
  vocabulary: VocabularySource,
): SelectionCandidate[] {
  const data = dataFor(guestId);
  // Only entries with at least one accepted answer, matching the user query, so
  // an unanswerable entry is never asked of a guest either.
  const entries = vocabulary().filter((entry) => entry.answers.length > 0);
  const history = new Map<string, GuestAttempt[]>();
  for (const attempt of data.attempts) {
    const list = history.get(attempt.vocabularyEntryId) ?? [];
    list.push(attempt);
    history.set(attempt.vocabularyEntryId, list);
  }
  return entries
    .map((entry) => {
      const attempts = (history.get(entry.id) ?? [])
        .slice()
        .sort((a, b) => Date.parse(b.attemptedAt) - Date.parse(a.attemptedAt));
      const withinWindow = attempts.slice(0, recentAttemptWindow);
      return {
        id: entry.id,
        attempts: attempts.length,
        recentIncorrect: withinWindow.filter((attempt) => !attempt.correct).length,
        correctInSession: sessionId
          ? attempts.filter((a) => a.practiceSessionId === sessionId && a.correct).length
          : 0,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function getLastAttemptedEntryInSession(guestId: string, sessionId: string): string | null {
  const attempts = dataFor(guestId).sessions.get(sessionId)?.attempts ?? [];
  return attempts.length > 0 ? attempts[attempts.length - 1]!.vocabularyEntryId : null;
}

export function countIncorrectAttemptsInSession(
  guestId: string,
  sessionId: string,
  vocabularyEntryId: string,
): number {
  const attempts = dataFor(guestId).sessions.get(sessionId)?.attempts ?? [];
  return attempts.filter(
    (attempt) => attempt.vocabularyEntryId === vocabularyEntryId && !attempt.correct,
  ).length;
}

export function endPracticeSession(
  guestId: string,
  session: PracticeSessionRecord,
  now: string,
): PracticeSessionStatus {
  const stored = dataFor(guestId).sessions.get(session.id);
  if (!stored) return session.status;
  // Same policy as a user: answering everything completes, otherwise abandoned.
  const status: PracticeSessionStatus =
    session.answeredCount >= session.questionCount ? 'completed' : 'abandoned';
  stored.status = status;
  stored.endedAt = now;
  return status;
}

export function getPracticeSessionSummary(
  guestId: string,
  sessionId: string,
  vocabulary: VocabularySource,
): PracticeSessionSummary | undefined {
  const stored = dataFor(guestId).sessions.get(sessionId);
  if (!stored) return undefined;
  const correctCount = stored.attempts.filter((attempt) => attempt.correct).length;
  const words = new Map(vocabulary().map((entry) => [entry.id, entry.english]));
  const wordsToPractice = [
    ...new Set(
      stored.attempts
        .filter((attempt) => !attempt.correct)
        .map((attempt) => words.get(attempt.vocabularyEntryId))
        .filter((word): word is string => Boolean(word)),
    ),
  ].sort((a, b) => a.localeCompare(b));
  return {
    ...publicSession(stored),
    correctCount,
    incorrectCount: stored.answeredCount - correctCount,
    pointsEarned: stored.attempts.reduce((total, attempt) => total + attempt.scoreDelta, 0),
    accuracy: stored.answeredCount === 0 ? 0 : correctCount / stored.answeredCount,
    wordsToPractice,
  };
}

export function getDashboardSummary(
  guestId: string,
  vocabulary: VocabularySource,
): DashboardSummary {
  const attempts = dataFor(guestId).attempts;
  const correct = attempts.filter((attempt) => attempt.correct).length;
  const byEntry = new Map<string, number>();
  for (const attempt of attempts) {
    if (!attempt.correct) {
      byEntry.set(attempt.vocabularyEntryId, (byEntry.get(attempt.vocabularyEntryId) ?? 0) + 1);
    }
  }
  const words = new Map(vocabulary().map((entry) => [entry.id, entry.english]));
  return {
    totalPoints: attempts.reduce((total, attempt) => total + attempt.scoreDelta, 0),
    totalAttempts: attempts.length,
    accuracy: attempts.length === 0 ? 0 : correct / attempts.length,
    recentActivity: [...attempts]
      .sort((a, b) => Date.parse(b.attemptedAt) - Date.parse(a.attemptedAt))
      .slice(0, 10)
      .map((attempt) => ({
        attemptedAt: attempt.attemptedAt,
        direction: attempt.direction,
        correct: attempt.correct,
      })),
    repeatedErrorWords: [...byEntry.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([entryId]) => words.get(entryId))
      .filter((word): word is string => Boolean(word)),
  };
}

/** Advances a guest session's answered counter after a recorded attempt. */
export function bumpAnsweredCount(guestId: string, sessionId: string): void {
  const session = dataFor(guestId).sessions.get(sessionId);
  if (session) session.answeredCount += 1;
}
