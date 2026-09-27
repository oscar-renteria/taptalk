import type {
  DashboardSummary,
  ExamHistoryEntry,
  ExamResult,
  ExamStatistics,
  PracticeDirection,
  UserPreferences,
} from '@taptalk/shared';
import { recentAttemptWindow, type SelectionCandidate } from './selection.js';
import type {
  PracticeSessionRecord,
  PracticeVocabularyEntry,
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

type GuestSession = PracticeSessionRecord & { attempts: GuestAttempt[]; kind: 'practice' | 'exam' };

type GuestData = {
  preferences: UserPreferences;
  sessions: Map<string, GuestSession>;
  attempts: GuestAttempt[];
  /** Vocabulary entries the guest has switched off for practice. */
  excludedEntryIds: Set<string>;
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
    excludedEntryIds: new Set(),
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
  session: {
    id: string;
    direction: PracticeDirection;
    questionCount: number;
    kind?: 'practice' | 'exam';
  },
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
    kind: session.kind ?? 'practice',
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
  // an unanswerable entry is never asked of a guest either. Entries the guest
  // switched off are excluded here, the same place the user query filters them,
  // so a disabled entry can never be asked of either kind of session.
  const entries = vocabulary().filter(
    (entry) => entry.answers.length > 0 && !data.excludedEntryIds.has(entry.id),
  );
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

// --- Practice vocabulary selection -------------------------------------------
//
// The guest mirror of the repository functions above. Held in the same
// in-memory record, so a guest's selection is temporary exactly like the rest of
// their session and is never written anywhere.

export function getPracticeVocabulary(
  guestId: string,
  vocabulary: VocabularySource,
): PracticeVocabularyEntry[] {
  const disabled = dataFor(guestId).excludedEntryIds;
  return vocabulary()
    .map((entry) => ({
      id: entry.id,
      english: entry.english,
      german: entry.germanDisplay,
      enabled: !disabled.has(entry.id),
    }))
    .sort((a, b) => a.english.localeCompare(b.english) || a.id.localeCompare(b.id));
}

export function setPracticeVocabularyExclusions(
  guestId: string,
  vocabulary: VocabularySource,
  disabledIds: string[],
): PracticeVocabularyEntry[] {
  const unique = [...new Set(disabledIds)];
  const known = new Set(vocabulary().map((entry) => entry.id));
  const unknown = unique.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    const error = new Error('One or more vocabulary entries do not exist.');
    error.name = 'GuestVocabularyError';
    throw error;
  }
  dataFor(guestId).excludedEntryIds = new Set(unique);
  return getPracticeVocabulary(guestId, vocabulary);
}

/** How many entries a guest can still practise. */
export function countPracticeVocabulary(guestId: string, vocabulary: VocabularySource): number {
  const disabled = dataFor(guestId).excludedEntryIds;
  return vocabulary().reduce((total, entry) => total + (disabled.has(entry.id) ? 0 : 1), 0);
}

// --- Exam Mode (guests) ------------------------------------------------------
//
// The guest mirror of the exam functions in repositories.ts. Everything stays in
// the in-memory record, so a guest exam produces results and statistics without
// any database row, exactly like the rest of guest state.

export function getExamResult(
  guestId: string,
  sessionId: string,
  vocabulary: VocabularySource,
): ExamResult | undefined {
  const stored = dataFor(guestId).sessions.get(sessionId);
  if (!stored || stored.kind !== 'exam' || stored.status === 'active' || !stored.endedAt) {
    return undefined;
  }
  // Attempts never store the answer, so the review recovers it from vocabulary.
  const entries = new Map(vocabulary().map((entry) => [entry.id, entry]));
  const questions = stored.attempts.map((attempt, index) => {
    const entry = entries.get(attempt.vocabularyEntryId);
    return {
      index: index + 1,
      vocabularyEntryId: attempt.vocabularyEntryId,
      prompt: attempt.prompt,
      direction: attempt.direction,
      submittedAnswer: attempt.submittedAnswer,
      correctAnswer:
        entry && attempt.direction === 'english-to-german'
          ? entry.germanDisplay
          : (entry?.english ?? ''),
      correct: attempt.correct,
    };
  });
  const correctCount = questions.filter((question) => question.correct).length;
  return {
    id: stored.id,
    direction: stored.direction,
    status: stored.status,
    totalQuestions: questions.length,
    correctCount,
    incorrectCount: questions.length - correctCount,
    score: guestExamScore(correctCount, questions.length),
    durationSeconds: Math.max(
      0,
      Math.round((Date.parse(stored.endedAt) - Date.parse(stored.startedAt)) / 1000),
    ),
    startedAt: stored.startedAt,
    endedAt: stored.endedAt,
    questions,
  };
}

/** Mirrors `examScore` so guests and users are scored identically. */
export function guestExamScore(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

export function getExamHistory(guestId: string, limit: number): ExamHistoryEntry[] {
  return [...dataFor(guestId).sessions.values()]
    .filter(
      (session) =>
        session.kind === 'exam' && session.status !== 'active' && session.endedAt !== null,
    )
    .sort((a, b) => Date.parse(b.endedAt!) - Date.parse(a.endedAt!))
    .slice(0, limit)
    .map((session) => {
      const correctCount = session.attempts.filter((attempt) => attempt.correct).length;
      return {
        id: session.id,
        score: guestExamScore(correctCount, session.attempts.length),
        correctCount,
        totalQuestions: session.attempts.length,
        endedAt: session.endedAt!,
      };
    });
}

export function getExamStatistics(guestId: string, trendLimit: number): ExamStatistics {
  const sessions = [...dataFor(guestId).sessions.values()]
    .filter(
      (session) =>
        session.kind === 'exam' && session.status !== 'active' && session.endedAt !== null,
    )
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  const scores = sessions.map((session) =>
    guestExamScore(
      session.attempts.filter((attempt) => attempt.correct).length,
      session.attempts.length,
    ),
  );
  const trend = scores.slice(-trendLimit);
  return {
    examsCompleted: sessions.length,
    averageScore:
      trend.length === 0
        ? 0
        : Math.round(trend.reduce((sum, score) => sum + score, 0) / trend.length),
    bestScore: trend.length === 0 ? 0 : Math.max(...trend),
    latestScore: trend.length === 0 ? 0 : trend[trend.length - 1]!,
    totalQuestionsAnswered: sessions.reduce(
      (total, session) => total + session.attempts.filter((attempt) => attempt.correct).length,
      0,
    ),
    scoreHistory: trend,
  };
}
