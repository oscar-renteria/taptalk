import type {
  DashboardSummary,
  ExamHistoryEntry,
  ExamResult,
  ExamStatistics,
  PracticeDirection,
  UserPreferences,
} from '@taptalk/shared';
import type { SqliteDatabase } from './database.js';
import { normalizeAnswer } from './matching.js';
import { assertPersistableUserId } from './persistence.js';
import {
  buildExamQuestionSet,
  recentAttemptWindow,
  type Direction,
  type DirectionPreference,
  type ExamQuestion,
  type RepetitionPreference,
  type SelectionCandidate,
} from './selection.js';
import type { ParsedVocabularyRecord } from './vocabulary.js';

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  role: 'user' | 'administrator';
  createdAt: string;
  updatedAt: string;
};

export type VocabularyRecord = {
  id: string;
  english: string;
  phonetics: string | null;
  germanDisplay: string;
  answers: string[];
};

export type PracticeSessionStatus = 'active' | 'completed' | 'abandoned';

export type PracticeSessionRecord = {
  id: string;
  userId: string;
  direction: PracticeDirection;
  questionCount: number;
  status: PracticeSessionStatus;
  startedAt: string;
  endedAt: string | null;
  answeredCount: number;
};

export type PracticeSessionSummary = PracticeSessionRecord & {
  correctCount: number;
  incorrectCount: number;
  pointsEarned: number;
  accuracy: number;
  wordsToPractice: string[];
};

export class RepositoryError extends Error {
  /** Ids the caller referenced that do not exist, when the error is about them. */
  unknownIds: string[] = [];
  constructor(
    message: string,
    readonly code: 'conflict' | 'invalid' | 'storage',
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'RepositoryError';
  }
}

function mapDatabaseError(error: unknown): RepositoryError {
  const message = error instanceof Error ? error.message : 'Database operation failed.';
  if (message.includes('UNIQUE constraint failed')) {
    return new RepositoryError('The record conflicts with existing data.', 'conflict', {
      cause: error,
    });
  }
  if (
    message.includes('FOREIGN KEY constraint failed') ||
    message.includes('CHECK constraint failed')
  ) {
    return new RepositoryError('The record violates a data constraint.', 'invalid', {
      cause: error,
    });
  }
  return new RepositoryError('The database operation could not be completed.', 'storage', {
    cause: error,
  });
}

export function findUserByUsername(
  database: SqliteDatabase,
  username: string,
): UserRecord | undefined {
  const row = database
    .prepare(
      `SELECT id, username, password_hash AS passwordHash, role, created_at AS createdAt, updated_at AS updatedAt
       FROM users WHERE LOWER(username) = LOWER(?)`,
    )
    .get(username) as UserRecord | undefined;
  return row;
}

export function insertUser(database: SqliteDatabase, user: UserRecord): void {
  try {
    database
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(user.id, user.username, user.passwordHash, user.role, user.createdAt, user.updatedAt);
  } catch (error) {
    throw mapDatabaseError(error);
  }
}

export function getVocabulary(database: SqliteDatabase): VocabularyRecord[] {
  const rows = database
    .prepare(
      `SELECT e.id, e.english, e.phonetics, e.german_display AS germanDisplay,
              a.answer
       FROM vocabulary_entries e
       LEFT JOIN vocabulary_answers a ON a.vocabulary_entry_id = e.id
       ORDER BY e.id, a.id`,
    )
    .all() as Array<Omit<VocabularyRecord, 'answers'> & { answer: string | null }>;
  const entries = new Map<string, VocabularyRecord>();
  for (const row of rows) {
    const entry = entries.get(row.id) ?? { ...row, answers: [] };
    if (row.answer !== null) {
      entry.answers.push(row.answer);
    }
    entries.set(row.id, entry);
  }
  return [...entries.values()];
}

export function upsertVocabulary(
  database: SqliteDatabase,
  entry: VocabularyRecord,
  now: string,
): void {
  database.exec('BEGIN');
  try {
    database
      .prepare(
        `INSERT INTO vocabulary_entries (id, english, phonetics, german_display, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET english = excluded.english, phonetics = excluded.phonetics,
         german_display = excluded.german_display, updated_at = excluded.updated_at`,
      )
      .run(entry.id, entry.english, entry.phonetics, entry.germanDisplay, now, now);
    database.prepare('DELETE FROM vocabulary_answers WHERE vocabulary_entry_id = ?').run(entry.id);
    const answerStatement = database.prepare(
      `INSERT INTO vocabulary_answers (id, vocabulary_entry_id, answer, normalized_answer)
       VALUES (?, ?, ?, ?)`,
    );
    for (const answer of entry.answers) {
      answerStatement.run(crypto.randomUUID(), entry.id, answer, normalizeAnswer(answer));
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw mapDatabaseError(error);
  }
}

export function commitVocabularyImport(
  database: SqliteDatabase,
  userId: string,
  records: ParsedVocabularyRecord[],
  sourceName: string | null,
  now: string,
): { importId: string; addedCount: number; updatedCount: number } {
  const importId = crypto.randomUUID();
  let addedCount = 0;
  let updatedCount = 0;
  database.exec('BEGIN');
  try {
    const existingRows = database
      .prepare('SELECT id, english FROM vocabulary_entries')
      .all() as Array<{
      id: string;
      english: string;
    }>;
    const existing = new Map(
      existingRows.map((row) => [row.english.normalize('NFKC').trim().toLocaleLowerCase(), row.id]),
    );
    for (const record of records) {
      const key = record.english.normalize('NFKC').trim().toLocaleLowerCase();
      const entryId = existing.get(key) ?? crypto.randomUUID();
      if (existing.has(key)) updatedCount += 1;
      else addedCount += 1;
      database
        .prepare(
          `INSERT INTO vocabulary_entries (id, english, phonetics, german_display, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET english = excluded.english, phonetics = excluded.phonetics,
           german_display = excluded.german_display, updated_at = excluded.updated_at`,
        )
        .run(entryId, record.english, record.phonetics ?? null, record.german, now, now);
      database.prepare('DELETE FROM vocabulary_answers WHERE vocabulary_entry_id = ?').run(entryId);
      const answerStatement = database.prepare(
        `INSERT INTO vocabulary_answers (id, vocabulary_entry_id, answer, normalized_answer)
         VALUES (?, ?, ?, ?)`,
      );
      for (const answer of record.alternatives) {
        answerStatement.run(crypto.randomUUID(), entryId, answer, normalizeAnswer(answer));
      }
    }
    database
      .prepare(
        `INSERT INTO vocabulary_imports
         (id, initiated_by_user_id, status, source_name, record_count, added_count, updated_count, error_count, created_at, completed_at)
         VALUES (?, ?, 'committed', ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(importId, userId, sourceName, records.length, addedCount, updatedCount, now, now);
    database.exec('COMMIT');
    return { importId, addedCount, updatedCount };
  } catch (error) {
    database.exec('ROLLBACK');
    throw mapDatabaseError(error);
  }
}

export function getVocabularyImportHistory(
  database: SqliteDatabase,
  limit = 20,
): Array<{
  id: string;
  sourceName: string | null;
  status: 'previewed' | 'committed' | 'failed';
  recordCount: number;
  addedCount: number;
  updatedCount: number;
  errorCount: number;
  createdAt: string;
  completedAt: string | null;
}> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return database
    .prepare(
      `SELECT id, source_name AS sourceName, status, record_count AS recordCount,
              added_count AS addedCount, updated_count AS updatedCount, error_count AS errorCount,
              created_at AS createdAt, completed_at AS completedAt
       FROM vocabulary_imports ORDER BY created_at DESC LIMIT ?`,
    )
    .all(boundedLimit) as Array<{
    id: string;
    sourceName: string | null;
    status: 'previewed' | 'committed' | 'failed';
    recordCount: number;
    addedCount: number;
    updatedCount: number;
    errorCount: number;
    createdAt: string;
    completedAt: string | null;
  }>;
}

export function ensurePreferences(database: SqliteDatabase, userId: string, now: string): void {
  assertPersistableUserId(userId, 'ensurePreferences');
  database
    .prepare(
      `INSERT INTO user_preferences (user_id, updated_at) VALUES (?, ?)
       ON CONFLICT(user_id) DO NOTHING`,
    )
    .run(userId, now);
}

export function getPreferences(database: SqliteDatabase, userId: string): UserPreferences {
  const row = database
    .prepare(
      `SELECT direction, session_length AS sessionLength, repetition_preference AS repetitionPreference
       FROM user_preferences WHERE user_id = ?`,
    )
    .get(userId) as UserPreferences | undefined;
  return (
    row ?? {
      direction: 'random',
      sessionLength: 10,
      repetitionPreference: 'balanced',
    }
  );
}

export function updatePreferences(
  database: SqliteDatabase,
  userId: string,
  preferences: UserPreferences,
  now: string,
): UserPreferences {
  assertPersistableUserId(userId, 'updatePreferences');
  database
    .prepare(
      `INSERT INTO user_preferences (user_id, direction, session_length, repetition_preference, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET direction = excluded.direction,
       session_length = excluded.session_length, repetition_preference = excluded.repetition_preference,
       updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      preferences.direction,
      preferences.sessionLength,
      preferences.repetitionPreference,
      now,
    );
  return preferences;
}

export function recordAttempt(
  database: SqliteDatabase,
  attempt: {
    id: string;
    userId: string;
    vocabularyEntryId: string;
    direction: Exclude<PracticeDirection, 'random'>;
    prompt: string;
    submittedAnswer: string;
    normalizedAnswer: string;
    correct: boolean;
    scoreDelta: number;
    matchingReason: string;
    attemptedAt: string;
    practiceSessionId?: string | null;
  },
): void {
  assertPersistableUserId(attempt.userId, 'recordAttempt');
  database
    .prepare(
      `INSERT INTO learning_attempts
       (id, user_id, vocabulary_entry_id, direction, prompt, submitted_answer, normalized_answer,
        correct, score_delta, matching_reason, attempted_at, practice_session_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      attempt.id,
      attempt.userId,
      attempt.vocabularyEntryId,
      attempt.direction,
      attempt.prompt,
      attempt.submittedAnswer,
      attempt.normalizedAnswer,
      attempt.correct ? 1 : 0,
      attempt.scoreDelta,
      attempt.matchingReason,
      attempt.attemptedAt,
      attempt.practiceSessionId ?? null,
    );
}

export function getDashboardSummary(database: SqliteDatabase, userId: string): DashboardSummary {
  assertPersistableUserId(userId, 'getDashboardSummary');
  const totals = database
    .prepare(
      `SELECT COUNT(*) AS totalAttempts,
              COALESCE(SUM(score_delta), 0) AS totalPoints,
              COALESCE(AVG(correct), 0) AS accuracy
       FROM learning_attempts WHERE user_id = ?`,
    )
    .get(userId) as { totalAttempts: number; totalPoints: number; accuracy: number };
  const recentActivity = database
    .prepare(
      `SELECT attempted_at AS attemptedAt, direction, correct
       FROM learning_attempts WHERE user_id = ? ORDER BY attempted_at DESC LIMIT 10`,
    )
    .all(userId) as Array<{
    attemptedAt: string;
    direction: 'english-to-german' | 'german-to-english';
    correct: number;
  }>;
  const repeatedErrorWords = database
    .prepare(
      `SELECT v.english AS word FROM learning_attempts a
       JOIN vocabulary_entries v ON v.id = a.vocabulary_entry_id
       WHERE a.user_id = ? AND a.correct = 0
       GROUP BY a.vocabulary_entry_id, v.english ORDER BY COUNT(*) DESC LIMIT 10`,
    )
    .all(userId) as Array<{ word: string }>;
  return {
    totalPoints: Number(totals.totalPoints),
    totalAttempts: Number(totals.totalAttempts),
    accuracy: Number(totals.accuracy),
    recentActivity: recentActivity.map((activity) => ({
      attemptedAt: activity.attemptedAt,
      direction: activity.direction,
      correct: activity.correct === 1,
    })),
    repeatedErrorWords: repeatedErrorWords.map((entry) => entry.word),
  };
}

export function updatePasswordHash(
  database: SqliteDatabase,
  userId: string,
  passwordHash: string,
  now: string,
): void {
  database
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, now, userId);
}

export function setUserRole(
  database: SqliteDatabase,
  username: string,
  role: UserRecord['role'],
  now: string,
): boolean {
  const result = database
    .prepare('UPDATE users SET role = ?, updated_at = ? WHERE LOWER(username) = LOWER(?)')
    .run(role, now, username);
  return Number(result.changes) === 1;
}

// Policy: a user has at most one active session. Starting a new one abandons the previous one.
export function startPracticeSession(
  database: SqliteDatabase,
  session: {
    id: string;
    userId: string;
    direction: PracticeDirection;
    questionCount: number;
    /** 'exam' marks a testing session; omitted for ordinary practice. */
    kind?: SessionKind;
    /**
     * The vocabulary scope this session runs under, fixed at start. A group id is
     * stored alongside a name snapshot so the session keeps its label even if the
     * group is later renamed or deleted.
     */
    vocabularyGroupId?: string | null;
    vocabularyGroupName?: string | null;
  },
  now: string,
): PracticeSessionRecord {
  assertPersistableUserId(session.userId, 'startPracticeSession');
  const kind: SessionKind = session.kind ?? 'practice';
  database.exec('BEGIN');
  try {
    database
      .prepare(
        `UPDATE practice_sessions SET status = 'abandoned', ended_at = ?
         WHERE user_id = ? AND status = 'active'`,
      )
      .run(now, session.userId);
    database
      .prepare(
        `INSERT INTO practice_sessions (id, user_id, direction, question_count, status, started_at, kind, vocabulary_group_id, vocabulary_group_name)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.userId,
        session.direction,
        session.questionCount,
        now,
        kind,
        session.vocabularyGroupId ?? null,
        session.vocabularyGroupName ?? null,
      );
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return { ...session, status: 'active', startedAt: now, endedAt: null, answeredCount: 0 };
}

export function getPracticeSession(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
): PracticeSessionRecord | undefined {
  const row = database
    .prepare(
      `SELECT s.id, s.user_id AS userId, s.direction, s.question_count AS questionCount, s.status,
              s.started_at AS startedAt, s.ended_at AS endedAt,
              s.vocabulary_group_id AS vocabularyGroupId,
              s.vocabulary_group_name AS vocabularyGroupName,
              (SELECT COUNT(*) FROM learning_attempts a WHERE a.practice_session_id = s.id) AS answeredCount
       FROM practice_sessions s WHERE s.id = ? AND s.user_id = ?`,
    )
    .get(sessionId, userId) as PracticeSessionRecord | undefined;
  return row ? { ...row, answeredCount: Number(row.answeredCount) } : undefined;
}

// --- Exam question set -------------------------------------------------------
// Written once when the exam starts and read back in order. Nothing re-derives a
// question from the live selection, so the exam cannot change under the learner.

/**
 * Draws and stores an exam's questions, and returns them.
 *
 * The session is created with the clamped length, not the requested one, so the
 * number the learner is told is the number they will actually answer: asking for
 * 20 with 12 eligible entries produces 12 questions.
 */
export function createExamQuestionSet(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
  candidates: SelectionCandidate[],
  options: {
    questionCount: number;
    direction: DirectionPreference;
    repetitionPreference: RepetitionPreference;
  },
  random: () => number,
): ExamQuestion[] {
  assertPersistableUserId(userId, 'createExamQuestionSet');
  const questions = buildExamQuestionSet(candidates, options, random);
  database.exec('BEGIN');
  try {
    database
      .prepare(
        `UPDATE practice_sessions SET question_count = ? WHERE id = ? AND user_id = ? AND kind = 'exam'`,
      )
      .run(questions.length, sessionId, userId);
    const insert = database.prepare(
      `INSERT INTO exam_questions (session_id, position, vocabulary_entry_id, direction)
       VALUES (?, ?, ?, ?)`,
    );
    for (const question of questions) {
      insert.run(sessionId, question.position, question.vocabularyEntryId, question.direction);
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return questions;
}

/** The exam's frozen questions, in order. */
export function getExamQuestions(database: SqliteDatabase, sessionId: string): ExamQuestion[] {
  const rows = database
    .prepare(
      `SELECT position, vocabulary_entry_id AS vocabularyEntryId, direction
       FROM exam_questions WHERE session_id = ? ORDER BY position ASC`,
    )
    .all(sessionId) as Array<{ position: number; vocabularyEntryId: string; direction: Direction }>;
  return rows.map((row) => ({ ...row, position: Number(row.position) }));
}

/** One frozen question, by its position in the exam. */
export function getExamQuestionAt(
  database: SqliteDatabase,
  sessionId: string,
  position: number,
): ExamQuestion | undefined {
  const row = database
    .prepare(
      `SELECT position, vocabulary_entry_id AS vocabularyEntryId, direction
       FROM exam_questions WHERE session_id = ? AND position = ?`,
    )
    .get(sessionId, position) as
    { position: number; vocabularyEntryId: string; direction: Direction } | undefined;
  return row ? { ...row, position: Number(row.position) } : undefined;
}

// Per-entry learning history for question selection. Only entries with at least one accepted
// answer are candidates, so unanswerable entries are never asked.
/**
 * The vocabulary a user may practise, with each entry's selection statistics.
 *
 * `groupId` narrows the result to one of the learner's own groups. The ownership
 * check is the `g.user_id = ?` inside the EXISTS rather than a separate lookup,
 * so an unknown id, another learner's group, and "no group" cannot be told apart
 * by any caller that has not already proved ownership.
 *
 * Group membership narrows on top of the existing per-user on/off selection; it
 * never widens it, and it does not touch attempts, so weighting is unchanged.
 */
export function getSelectionCandidates(
  database: SqliteDatabase,
  userId: string,
  sessionId: string | null,
  groupId: string | null = null,
): SelectionCandidate[] {
  // Entries the user switched off in Settings are filtered out here, in the one
  // place questions are chosen from. A disabled entry therefore cannot be asked,
  // and the Settings list and Practice Mode cannot disagree.
  const rows = database
    .prepare(
      `WITH ranked AS (
         SELECT vocabulary_entry_id, correct, practice_session_id,
                ROW_NUMBER() OVER (PARTITION BY vocabulary_entry_id ORDER BY attempted_at DESC) AS position
         FROM learning_attempts WHERE user_id = ?
       )
       SELECT e.id AS id,
              COUNT(r.vocabulary_entry_id) AS attempts,
              COALESCE(SUM(CASE WHEN r.position <= ? AND r.correct = 0 THEN 1 ELSE 0 END), 0)
                AS recentIncorrect,
              COALESCE(SUM(CASE WHEN r.practice_session_id = ? AND r.correct = 1 THEN 1 ELSE 0 END), 0)
                AS correctInSession
       FROM vocabulary_entries e
       LEFT JOIN ranked r ON r.vocabulary_entry_id = e.id
       WHERE EXISTS (SELECT 1 FROM vocabulary_answers v WHERE v.vocabulary_entry_id = e.id)
         AND NOT EXISTS (
           SELECT 1 FROM user_practice_vocabulary_exclusions x
           WHERE x.vocabulary_entry_id = e.id AND x.user_id = ?
         )
         AND (? IS NULL OR EXISTS (
           SELECT 1 FROM vocabulary_group_entries ge
           JOIN vocabulary_groups g ON g.id = ge.group_id
           WHERE ge.vocabulary_entry_id = e.id AND ge.group_id = ? AND g.user_id = ?
         ))
       GROUP BY e.id
       ORDER BY e.id`,
    )
    .all(
      userId,
      recentAttemptWindow,
      sessionId,
      userId,
      groupId,
      groupId,
      userId,
    ) as SelectionCandidate[];
  return rows.map((row) => ({
    id: row.id,
    attempts: Number(row.attempts),
    recentIncorrect: Number(row.recentIncorrect),
    correctInSession: Number(row.correctInSession),
  }));
}

export function getLastAttemptedEntryInSession(
  database: SqliteDatabase,
  sessionId: string,
): string | null {
  const row = database
    .prepare(
      `SELECT vocabulary_entry_id AS id FROM learning_attempts
       WHERE practice_session_id = ? ORDER BY attempted_at DESC, rowid DESC LIMIT 1`,
    )
    .get(sessionId) as { id: string } | undefined;
  return row?.id ?? null;
}

export function countIncorrectAttemptsInSession(
  database: SqliteDatabase,
  sessionId: string,
  vocabularyEntryId: string,
): number {
  const row = database
    .prepare(
      `SELECT COUNT(*) AS count FROM learning_attempts
       WHERE practice_session_id = ? AND vocabulary_entry_id = ? AND correct = 0`,
    )
    .get(sessionId, vocabularyEntryId) as { count: number };
  return Number(row.count);
}

// Policy: ending a session after every question was answered completes it; ending earlier abandons it.
export function endPracticeSession(
  database: SqliteDatabase,
  session: PracticeSessionRecord,
  now: string,
): PracticeSessionStatus {
  const status = session.answeredCount >= session.questionCount ? 'completed' : 'abandoned';
  database
    .prepare(
      `UPDATE practice_sessions SET status = ?, ended_at = ? WHERE id = ? AND status = 'active'`,
    )
    .run(status, now, session.id);
  return status;
}

export function getPracticeSessionSummary(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
): PracticeSessionSummary | undefined {
  const session = getPracticeSession(database, userId, sessionId);
  if (!session) {
    return undefined;
  }
  const totals = database
    .prepare(
      `SELECT COALESCE(SUM(correct), 0) AS correctCount, COALESCE(SUM(score_delta), 0) AS pointsEarned
       FROM learning_attempts WHERE practice_session_id = ?`,
    )
    .get(sessionId) as { correctCount: number; pointsEarned: number };
  const wordsToPractice = database
    .prepare(
      `SELECT DISTINCT v.english AS word FROM learning_attempts a
       JOIN vocabulary_entries v ON v.id = a.vocabulary_entry_id
       WHERE a.practice_session_id = ? AND a.correct = 0 ORDER BY v.english`,
    )
    .all(sessionId) as Array<{ word: string }>;
  const correctCount = Number(totals.correctCount);
  return {
    ...session,
    correctCount,
    incorrectCount: session.answeredCount - correctCount,
    pointsEarned: Number(totals.pointsEarned),
    accuracy: session.answeredCount === 0 ? 0 : correctCount / session.answeredCount,
    wordsToPractice: wordsToPractice.map((entry) => entry.word),
  };
}

// --- Practice vocabulary selection -------------------------------------------
//
// Practice eligibility is the single source of truth for both the Settings list
// and question selection: a disabled entry is excluded from `selectQuestion` by
// the same row that makes its Settings checkbox unticked. There is no second copy
// of the rule.

export type PracticeVocabularyEntry = {
  id: string;
  english: string;
  german: string;
  enabled: boolean;
};

/** The vocabulary a user can practise, with each entry's current state. */
export function getPracticeVocabulary(
  database: SqliteDatabase,
  userId: string,
): PracticeVocabularyEntry[] {
  assertPersistableUserId(userId, 'getPracticeVocabulary');
  const rows = database
    .prepare(
      `SELECT e.id, e.english, e.german_display AS german,
              CASE WHEN x.vocabulary_entry_id IS NULL THEN 1 ELSE 0 END AS enabled
       FROM vocabulary_entries e
       LEFT JOIN user_practice_vocabulary_exclusions x
         ON x.vocabulary_entry_id = e.id AND x.user_id = ?
       ORDER BY e.english, e.id`,
    )
    .all(userId) as Array<{ id: string; english: string; german: string; enabled: number }>;
  return rows.map((row) => ({
    id: row.id,
    english: row.english,
    german: row.german,
    enabled: row.enabled === 1,
  }));
}

/**
 * Replaces a user's disabled set. Ids are validated against the real vocabulary
 * so a client cannot invent entries, and the whole set is written in one
 * transaction, which is also what keeps this to one request per edit rather than
 * one per checkbox.
 */
export function setPracticeVocabularyExclusions(
  database: SqliteDatabase,
  userId: string,
  disabledIds: string[],
  now: string,
): PracticeVocabularyEntry[] {
  assertPersistableUserId(userId, 'setPracticeVocabularyExclusions');
  const unique = [...new Set(disabledIds)];
  if (unique.length > 0) {
    const placeholders = unique.map(() => '?').join(', ');
    const known = database
      .prepare(`SELECT id FROM vocabulary_entries WHERE id IN (${placeholders})`)
      .all(...unique) as Array<{ id: string }>;
    if (known.length !== unique.length) {
      const knownIds = new Set(known.map((row) => row.id));
      const unknown = unique.filter((id) => !knownIds.has(id));
      const error = new RepositoryError('One or more vocabulary entries do not exist.', 'invalid');
      error.unknownIds = unknown.slice(0, 20);
      throw error;
    }
  }
  database.exec('BEGIN');
  try {
    database
      .prepare('DELETE FROM user_practice_vocabulary_exclusions WHERE user_id = ?')
      .run(userId);
    const insert = database.prepare(
      `INSERT INTO user_practice_vocabulary_exclusions
         (user_id, vocabulary_entry_id, excluded_at) VALUES (?, ?, ?)`,
    );
    for (const id of unique) insert.run(userId, id, now);
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  return getPracticeVocabulary(database, userId);
}

/** Ids the user has switched off. Used to filter practice candidates. */
function getExcludedEntryIds(database: SqliteDatabase, userId: string): Set<string> {
  const rows = database
    .prepare(
      'SELECT vocabulary_entry_id FROM user_practice_vocabulary_exclusions WHERE user_id = ?',
    )
    .all(userId) as Array<{ vocabulary_entry_id: string }>;
  return new Set(rows.map((row) => row.vocabulary_entry_id));
}

/**
 * Number of entries a user can actually practise. A round is only started when
 * this is greater than zero, so disabling everything produces a clear message
 * instead of an empty, broken session.
 */
export function countPracticeVocabulary(database: SqliteDatabase, userId: string): number {
  assertPersistableUserId(userId, 'countPracticeVocabulary');
  const excluded = getExcludedEntryIds(database, userId);
  if (excluded.size === 0) {
    return Number(
      (
        database.prepare('SELECT COUNT(*) AS total FROM vocabulary_entries').get() as {
          total: number;
        }
      ).total,
    );
  }
  const rows = database.prepare('SELECT id FROM vocabulary_entries').all() as Array<{ id: string }>;
  return rows.reduce((total, row) => total + (excluded.has(row.id) ? 0 : 1), 0);
}

// --- Exam Mode ---------------------------------------------------------------
//
// An exam is a practice session with kind = 'exam', so question selection,
// answer matching, and session lifecycle are the existing ones. These functions
// only add what an exam needs on top: results, review, history, and aggregates.

export type SessionKind = 'practice' | 'exam';

/**
 * Percentage score, rounded to a whole number so the same exam always produces
 * the same number. An unanswered exam scores 0 rather than dividing by zero.
 */
export function examScore(correct: number, total: number): number {
  return total === 0 ? 0 : Math.round((correct / total) * 100);
}

/** The full result and its review. Only valid once the exam is no longer active. */
export function getExamResult(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
): ExamResult | undefined {
  assertPersistableUserId(userId, 'getExamResult');
  const session = database
    .prepare(
      `SELECT id, direction, status, question_count AS totalQuestions,
              started_at AS startedAt, ended_at AS endedAt
       FROM practice_sessions WHERE id = ? AND user_id = ? AND kind = 'exam'`,
    )
    .get(sessionId, userId) as
    | {
        id: string;
        direction: PracticeDirection;
        status: 'active' | 'completed' | 'abandoned';
        totalQuestions: number;
        startedAt: string;
        endedAt: string | null;
      }
    | undefined;
  if (!session || session.status === 'active' || !session.endedAt) return undefined;

  // `correctAnswer` is the side the learner owed, which the direction decides:
  // English -> German owes the German, German -> English owes the English. This CASE
  // mirrors `correctAnswerFor` in review.ts, and review.test.ts pins the two together
  // so the persisted review cannot drift from the guest review again.
  //
  // COALESCE falls back to the prompt only when the vocabulary entry has since been
  // deleted, where the prompt is the only thing left to show.
  const answers = database
    .prepare(
      `SELECT a.vocabulary_entry_id AS vocabularyEntryId, a.prompt, a.direction,
              a.submitted_answer AS submittedAnswer, a.correct,
              COALESCE(CASE a.direction
                WHEN 'english-to-german' THEN (
                  SELECT v.german_display FROM vocabulary_entries v WHERE v.id = a.vocabulary_entry_id
                )
                ELSE (
                  SELECT v.english FROM vocabulary_entries v WHERE v.id = a.vocabulary_entry_id
                )
              END, a.prompt) AS correctAnswer
       FROM learning_attempts a
       WHERE a.practice_session_id = ?
       ORDER BY a.attempted_at ASC, a.rowid ASC`,
    )
    .all(sessionId) as Array<{
    vocabularyEntryId: string;
    prompt: string;
    direction: 'english-to-german' | 'german-to-english';
    submittedAnswer: string;
    correct: number;
    correctAnswer: string;
  }>;

  const questions = answers.map((row, index) => ({
    index: index + 1,
    vocabularyEntryId: row.vocabularyEntryId,
    prompt: row.prompt,
    direction: row.direction,
    submittedAnswer: row.submittedAnswer,
    correctAnswer: row.correctAnswer,
    correct: row.correct === 1,
  }));
  const correctCount = questions.filter((question) => question.correct).length;
  const totalQuestions = questions.length;
  return {
    id: session.id,
    direction: session.direction,
    status: session.status,
    totalQuestions,
    correctCount,
    incorrectCount: totalQuestions - correctCount,
    score: examScore(correctCount, totalQuestions),
    durationSeconds: Math.max(
      0,
      Math.round((Date.parse(session.endedAt) - Date.parse(session.startedAt)) / 1000),
    ),
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    questions,
  };
}

export function getExamHistory(
  database: SqliteDatabase,
  userId: string,
  limit: number,
): ExamHistoryEntry[] {
  assertPersistableUserId(userId, 'getExamHistory');
  const rows = database
    .prepare(
      `SELECT s.id, s.ended_at AS endedAt, s.question_count AS totalQuestions,
              s.vocabulary_group_name AS vocabularyGroupName,
              (SELECT COUNT(*) FROM learning_attempts a
                WHERE a.practice_session_id = s.id AND a.correct = 1) AS correctCount
       FROM practice_sessions s
       WHERE s.user_id = ? AND s.kind = 'exam' AND s.status = 'completed' AND s.ended_at IS NOT NULL
       ORDER BY s.ended_at DESC, s.id DESC
       LIMIT ?`,
    )
    .all(userId, limit) as Array<{
    id: string;
    endedAt: string;
    totalQuestions: number;
    correctCount: number;
  }>;
  return rows.map((row) => ({
    id: row.id,
    score: examScore(Number(row.correctCount), Number(row.totalQuestions)),
    correctCount: Number(row.correctCount),
    totalQuestions: Number(row.totalQuestions),
    endedAt: row.endedAt,
  }));
}

/**
 * Exam aggregates, computed in SQL so the Progress page never has to download the
 * history to average it. `scoreHistory` is capped and returned oldest first for
 * the trend, which is the only part that needs the individual results.
 */
export function getExamStatistics(
  database: SqliteDatabase,
  userId: string,
  trendLimit: number,
): ExamStatistics {
  assertPersistableUserId(userId, 'getExamStatistics');
  const totals = database
    .prepare(
      `SELECT COUNT(*) AS examsCompleted,
              COALESCE(SUM(s.question_count), 0) AS totalQuestions
       FROM practice_sessions s
       WHERE s.user_id = ? AND s.kind = 'exam' AND s.status = 'completed' AND s.ended_at IS NOT NULL`,
    )
    .get(userId) as { examsCompleted: number; totalQuestions: number };

  const examsCompleted = Number(totals.examsCompleted);
  // Every question in a completed exam was answered, so the question count is the
  // number answered. This is deliberately the total, not the number answered
  // correctly: "questions answered" is not a score.
  const totalQuestionsAnswered = Number(totals.totalQuestions);

  const trend = database
    .prepare(
      `SELECT s.id, s.question_count AS totalQuestions,
              (SELECT COUNT(*) FROM learning_attempts a
                WHERE a.practice_session_id = s.id AND a.correct = 1) AS correctCount
       FROM practice_sessions s
       WHERE s.user_id = ? AND s.kind = 'exam' AND s.status = 'completed' AND s.ended_at IS NOT NULL
       ORDER BY s.ended_at ASC, s.id ASC
       LIMIT ?`,
    )
    .all(userId, trendLimit) as Array<{ id: string; totalQuestions: number; correctCount: number }>;
  const scoreHistory = trend.map((row) =>
    examScore(Number(row.correctCount), Number(row.totalQuestions)),
  );

  // Scores are whole percentages, so the average is a mean of those, rounded the
  // same way. With no exams the figures are 0 rather than undefined.
  const average =
    scoreHistory.length === 0
      ? 0
      : Math.round(scoreHistory.reduce((sum, score) => sum + score, 0) / scoreHistory.length);

  return {
    examsCompleted,
    averageScore: average,
    bestScore: scoreHistory.length === 0 ? 0 : Math.max(...scoreHistory),
    latestScore: scoreHistory.length === 0 ? 0 : scoreHistory[scoreHistory.length - 1]!,
    totalQuestionsAnswered,
    scoreHistory,
  };
}
// --- Shared results & referral attribution -------------------------------------
//
// A share row is a pointer, not a copy: the card is always rendered from the
// session's persisted attempts (see `readShareableResult`), so there is exactly
// one source of truth for a score and no snapshot that can fall out of date.

export type ShareableResult = {
  sessionId: string;
  kind: SessionKind;
  direction: PracticeDirection;
  status: PracticeSessionStatus;
  correctCount: number;
  totalQuestions: number;
};

export type SharedResultRecord = {
  id: string;
  userId: string;
  sessionId: string;
  token: string;
  createdAt: string;
  revokedAt: string | null;
};

/**
 * The authoritative result behind a share, scoped to the owner.
 *
 * Scoping by `user_id` in the WHERE clause is the authorization check: a session
 * belonging to somebody else returns `undefined`, which the route reports as a
 * generic "not found", so ownership cannot be probed through the error.
 *
 * `totalQuestions` counts recorded attempts rather than the questions the
 * session planned, so a card can never claim an answer to a question that was
 * never asked, and cannot be inflated by ending a session early.
 */
export function readShareableResult(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
): ShareableResult | undefined {
  assertPersistableUserId(userId, 'readShareableResult');
  const row = database
    .prepare(
      `SELECT s.id AS sessionId, s.kind, s.direction, s.status,
              COALESCE(SUM(a.correct), 0) AS correctCount,
              COUNT(a.id) AS totalQuestions
       FROM practice_sessions s
       LEFT JOIN learning_attempts a ON a.practice_session_id = s.id
       WHERE s.id = ? AND s.user_id = ?
       GROUP BY s.id`,
    )
    .get(sessionId, userId) as
    | {
        sessionId: string;
        kind: SessionKind;
        direction: PracticeDirection;
        status: PracticeSessionStatus;
        correctCount: number;
        totalQuestions: number;
      }
    | undefined;
  if (!row) return undefined;
  return {
    sessionId: row.sessionId,
    kind: row.kind,
    direction: row.direction,
    status: row.status,
    correctCount: Number(row.correctCount),
    totalQuestions: Number(row.totalQuestions),
  };
}

/** Resolve a share by its public token, or `undefined` when it is unknown. */
export function getSharedResultByToken(
  database: SqliteDatabase,
  token: string,
): SharedResultRecord | undefined {
  const row = database
    .prepare(
      `SELECT id, user_id AS userId, session_id AS sessionId, token,
              created_at AS createdAt, revoked_at AS revokedAt
       FROM shared_results WHERE token = ?`,
    )
    .get(token) as SharedResultRecord | undefined;
  return row;
}

/**
 * Return the existing share for this session, creating one if needed.
 *
 * Idempotent by `(user_id, session_id)`: re-sharing a result returns the same
 * token and the same public URL rather than minting a second one. The lookup and
 * the insert share one immediate transaction so two concurrent shares of the same
 * session cannot both insert.
 */
export function createOrGetSharedResult(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
  token: string,
  now: string,
): SharedResultRecord {
  assertPersistableUserId(userId, 'createOrGetSharedResult');
  database.exec('BEGIN IMMEDIATE');
  try {
    const existing = database
      .prepare(
        `SELECT id, user_id AS userId, session_id AS sessionId, token,
                created_at AS createdAt, revoked_at AS revokedAt
         FROM shared_results WHERE user_id = ? AND session_id = ?`,
      )
      .get(userId, sessionId) as SharedResultRecord | undefined;
    if (existing) {
      database.exec('COMMIT');
      return existing;
    }
    const id = crypto.randomUUID();
    database
      .prepare(
        `INSERT INTO shared_results (id, user_id, session_id, token, created_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(id, userId, sessionId, token, now);
    database.exec('COMMIT');
    return { id, userId, sessionId, token, createdAt: now, revokedAt: null };
  } catch (error) {
    database.exec('ROLLBACK');
    throw mapDatabaseError(error);
  }
}

/** The owner's own shares, newest first. Scoped to the owner, never a public listing. */
export function listSharedResults(database: SqliteDatabase, userId: string): SharedResultRecord[] {
  assertPersistableUserId(userId, 'listSharedResults');
  return database
    .prepare(
      `SELECT id, user_id AS userId, session_id AS sessionId, token,
              created_at AS createdAt, revoked_at AS revokedAt
       FROM shared_results WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`,
    )
    .all(userId) as SharedResultRecord[];
}

/** Revoke one of the owner's shares. False when the id is not theirs. */
export function revokeSharedResult(
  database: SqliteDatabase,
  userId: string,
  shareId: string,
  now: string,
): boolean {
  assertPersistableUserId(userId, 'revokeSharedResult');
  const result = database
    .prepare(
      `UPDATE shared_results SET revoked_at = ?
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
    )
    .run(now, shareId, userId);
  return result.changes > 0;
}
/**
 * Record that `referredUserId` arrived through `token`'s share, at registration
 * or login.
 *
 * Self-referral is refused: a share can never be attributed to the person who
 * made it, which is what stops a token being used to manufacture fake signups.
 * The token is resolved by lookup rather than trusted from the cookie, so a
 * tampered cookie cannot name a share that does not exist, and `INSERT OR IGNORE`
 * keeps repeated logins idempotent against the unique (share, referred) index.
 */
export function recordReferralAttribution(
  database: SqliteDatabase,
  token: string,
  referredUserId: string,
  now: string,
): boolean {
  assertPersistableUserId(referredUserId, 'recordReferralAttribution');
  const share = getSharedResultByToken(database, token);
  if (!share || share.revokedAt !== null) return false;
  if (share.userId === referredUserId) return false;
  database
    .prepare(
      `INSERT OR IGNORE INTO referral_attributions
         (id, shared_result_id, referred_user_id, created_at, converted_at)
       VALUES (?, ?, ?, ?, NULL)`,
    )
    .run(crypto.randomUUID(), share.id, referredUserId, now);
  return true;
}

/**
 * Mark the referred learner's attribution converted on their first attempt.
 * True only for the row that flipped, so a caller counts one conversion rather
 * than one per answer.
 */
export function markReferralConverted(
  database: SqliteDatabase,
  referredUserId: string,
  now: string,
): boolean {
  assertPersistableUserId(referredUserId, 'markReferralConverted');
  const pending = database
    .prepare(
      `SELECT id FROM referral_attributions
       WHERE referred_user_id = ? AND converted_at IS NULL LIMIT 1`,
    )
    .get(referredUserId) as { id: string } | undefined;
  if (!pending) return false;
  database
    .prepare('UPDATE referral_attributions SET converted_at = ? WHERE id = ?')
    .run(now, pending.id);
  return true;
}

/** Aggregate referral counts for one share. Counts only, never the referred identity. */
export function getShareReferralStats(
  database: SqliteDatabase,
  userId: string,
  shareId: string,
): { sharedResultId: string; signups: number; startedPracticing: number } | undefined {
  assertPersistableUserId(userId, 'getShareReferralStats');
  const share = database
    .prepare('SELECT id FROM shared_results WHERE id = ? AND user_id = ?')
    .get(shareId, userId) as { id: string } | undefined;
  if (!share) return undefined;
  const totals = database
    .prepare(
      `SELECT COUNT(*) AS signups,
              COALESCE(SUM(CASE WHEN converted_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS converted
       FROM referral_attributions WHERE shared_result_id = ?`,
    )
    .get(shareId) as { signups: number; converted: number };
  return {
    sharedResultId: share.id,
    signups: Number(totals.signups),
    startedPracticing: Number(totals.converted),
  };
}

// --- Custom vocabulary groups -------------------------------------------------
//
// A group is a vocabulary scope: a named, user-owned selection of existing
// entries. Membership is a relationship, never a copy, so removing a word from a
// group leaves the vocabulary entry, its attempts, and its weighting untouched.
//
// Ownership is part of every query here rather than a separate check in the route,
// so there is no code path where a group id could be used without also proving
// the caller owns it.

export type VocabularyGroupRecord = {
  id: string;
  userId: string;
  name: string;
  selectedCount: number;
  createdAt: string;
  updatedAt: string;
};

/** Every vocabulary entry the learner may put in a group, with its membership flag.
 *
 * Returned in one request so the editor never needs a call per word. Entries are
 * the whole vocabulary the learner can see, not the ones enabled for Practice:
 * a group is an independent scope, and letting a learner add a word to a group
 * without also enabling it for Practice would be a surprising second rule.
 */
export function listVocabularyGroupEntries(
  database: SqliteDatabase,
  userId: string,
  groupId: string,
): { vocabularyEntryId: string; english: string; german: string; selected: boolean }[] {
  assertPersistableUserId(userId, 'listVocabularyGroupEntries');
  const rows = database
    .prepare(
      `SELECT e.id AS vocabularyEntryId, e.english, e.german_display AS german,
              EXISTS (
                SELECT 1 FROM vocabulary_group_entries ge
                WHERE ge.group_id = ? AND ge.vocabulary_entry_id = e.id
              ) AS selected
       FROM vocabulary_entries e
       ORDER BY e.english COLLATE NOCASE ASC, e.rowid ASC`,
    )
    .all(groupId) as Array<{
    vocabularyEntryId: string;
    english: string;
    german: string;
    selected: number;
  }>;
  return rows.map((row) => ({
    vocabularyEntryId: row.vocabularyEntryId,
    english: row.english,
    german: row.german,
    selected: row.selected === 1,
  }));
}

/** The learner's own groups, newest edit first. Scoped by user_id in the query. */
export function listVocabularyGroups(
  database: SqliteDatabase,
  userId: string,
): VocabularyGroupRecord[] {
  assertPersistableUserId(userId, 'listVocabularyGroups');
  return database
    .prepare(
      `SELECT g.id, g.user_id AS userId, g.name,
              (SELECT COUNT(*) FROM vocabulary_group_entries ge WHERE ge.group_id = g.id)
                AS selectedCount,
              g.created_at AS createdAt, g.updated_at AS updatedAt
       FROM vocabulary_groups g
       WHERE g.user_id = ?
       ORDER BY g.updated_at DESC, g.rowid DESC`,
    )
    .all(userId) as VocabularyGroupRecord[];
}

/** One group, or undefined when it does not exist *or* is not the learner's. */
export function getVocabularyGroup(
  database: SqliteDatabase,
  userId: string,
  groupId: string,
): VocabularyGroupRecord | undefined {
  assertPersistableUserId(userId, 'getVocabularyGroup');
  const row = database
    .prepare(
      `SELECT g.id, g.user_id AS userId, g.name,
              (SELECT COUNT(*) FROM vocabulary_group_entries ge WHERE ge.group_id = g.id)
                AS selectedCount,
              g.created_at AS createdAt, g.updated_at AS updatedAt
       FROM vocabulary_groups g WHERE g.id = ? AND g.user_id = ?`,
    )
    .get(groupId, userId) as VocabularyGroupRecord | undefined;
  if (!row) return undefined;
  return { ...row, selectedCount: Number(row.selectedCount) };
}

/** The group's membership as vocabulary ids, in the order the entries appear. */
export function listGroupEntryIds(
  database: SqliteDatabase,
  userId: string,
  groupId: string,
): string[] {
  assertPersistableUserId(userId, 'listGroupEntryIds');
  return (
    database
      .prepare(
        `SELECT ge.vocabulary_entry_id AS id FROM vocabulary_group_entries ge
         JOIN vocabulary_groups g ON g.id = ge.group_id
         WHERE ge.group_id = ? AND g.user_id = ?`,
      )
      .all(groupId, userId) as Array<{ id: string }>
  ).map((row) => row.id);
}

export function createVocabularyGroup(
  database: SqliteDatabase,
  userId: string,
  name: string,
  now: string,
): VocabularyGroupRecord {
  assertPersistableUserId(userId, 'createVocabularyGroup');
  const id = crypto.randomUUID();
  database
    .prepare(
      `INSERT INTO vocabulary_groups (id, user_id, name, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(id, userId, name, now, now);
  return { id, userId, name, selectedCount: 0, createdAt: now, updatedAt: now };
}

/** Rename. Ownership is in the WHERE clause, so another learner's group is untouched. */
export function renameVocabularyGroup(
  database: SqliteDatabase,
  userId: string,
  groupId: string,
  name: string,
  now: string,
): boolean {
  assertPersistableUserId(userId, 'renameVocabularyGroup');
  const result = database
    .prepare('UPDATE vocabulary_groups SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?')
    .run(name, now, groupId, userId);
  return result.changes > 0;
}

/**
 * Delete a group. Cascades to its membership rows only.
 *
 * `practice_sessions.vocabulary_group_id` is ON DELETE SET NULL and the name
 * snapshot is untouched, so historical sessions keep the label they were created
 * with and no vocabulary, attempt or score is affected.
 */
export function deleteVocabularyGroup(
  database: SqliteDatabase,
  userId: string,
  groupId: string,
): boolean {
  assertPersistableUserId(userId, 'deleteVocabularyGroup');
  const result = database
    .prepare('DELETE FROM vocabulary_groups WHERE id = ? AND user_id = ?')
    .run(groupId, userId);
  return result.changes > 0;
}

/**
 * Replace a group's membership with exactly `vocabularyEntryIds`.
 *
 * Membership is replaced rather than merged so the editor's "Select all" and
 * "Clear all" are one round trip rather than a diff the client has to compute.
 * Every id is validated against the real vocabulary table before anything is
 * written, so a caller cannot smuggle in an id that does not exist.
 */
export function setVocabularyGroupEntries(
  database: SqliteDatabase,
  userId: string,
  groupId: string,
  vocabularyEntryIds: string[],
  now: string,
): boolean {
  assertPersistableUserId(userId, 'setVocabularyGroupEntries');
  database.exec('BEGIN IMMEDIATE');
  try {
    // Ownership first: without a row this is somebody else's group.
    const owns = database
      .prepare('SELECT 1 AS ok FROM vocabulary_groups WHERE id = ? AND user_id = ?')
      .get(groupId, userId);
    if (!owns) {
      database.exec('ROLLBACK');
      return false;
    }
    if (vocabularyEntryIds.length > 0) {
      const placeholders = vocabularyEntryIds.map(() => '?').join(',');
      const found = database
        .prepare(`SELECT COUNT(*) AS n FROM vocabulary_entries WHERE id IN (${placeholders})`)
        .get(...vocabularyEntryIds) as { n: number };
      if (Number(found.n) !== new Set(vocabularyEntryIds).size) {
        database.exec('ROLLBACK');
        return false;
      }
    }
    database.prepare('DELETE FROM vocabulary_group_entries WHERE group_id = ?').run(groupId);
    const insert = database.prepare(
      `INSERT INTO vocabulary_group_entries (group_id, vocabulary_entry_id, added_at)
       VALUES (?, ?, ?)`,
    );
    // The primary key already prevents duplicates; dedupe keeps the insert count
    // honest rather than relying on a constraint error to abort the transaction.
    for (const entryId of new Set(vocabularyEntryIds)) insert.run(groupId, entryId, now);
    database.prepare('UPDATE vocabulary_groups SET updated_at = ? WHERE id = ?').run(now, groupId);
    database.exec('COMMIT');
    return true;
  } catch (error) {
    database.exec('ROLLBACK');
    throw mapDatabaseError(error);
  }
}

/**
 * The vocabulary scope a started session is running under.
 *
 * Read from the session, never from the request, so a client cannot widen or
 * narrow the vocabulary of a running session or exam. The name is the snapshot
 * taken at start, which is why it survives the group being renamed or deleted.
 */
export function getSessionVocabularyScope(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
): { groupId: string | null; groupName: string | null } | undefined {
  const row = database
    .prepare(
      `SELECT vocabulary_group_id AS groupId, vocabulary_group_name AS groupName
       FROM practice_sessions WHERE id = ? AND user_id = ?`,
    )
    .get(sessionId, userId) as { groupId: string | null; groupName: string | null } | undefined;
  return row ?? undefined;
}

/**
 * Pin the vocabulary a practice session may draw from.
 *
 * Written once, inside the session's own transaction, so the pool is resolved
 * exactly once. Later edits to a group cannot widen or narrow a running session,
 * and deleting the group cannot empty it.
 */
export function freezeSessionVocabulary(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
  vocabularyEntryIds: string[],
): void {
  assertPersistableUserId(userId, 'freezeSessionVocabulary');
  if (vocabularyEntryIds.length === 0) return;
  const insert = database.prepare(
    `INSERT OR IGNORE INTO practice_session_vocabulary (session_id, vocabulary_entry_id)
     VALUES (?, ?)`,
  );
  for (const entryId of vocabularyEntryIds) insert.run(sessionId, entryId);
}

/**
 * The vocabulary pinned to a session, or undefined when none was pinned.
 *
 * Undefined means "no pin", which is how a guest session and every session that
 * predates this table behave: their pool stays whatever the current settings say,
 * which is exactly the behaviour they had before grouping existed.
 */
export function listSessionVocabularyIds(
  database: SqliteDatabase,
  userId: string,
  sessionId: string,
): Set<string> | undefined {
  const rows = database
    .prepare(
      `SELECT sv.vocabulary_entry_id AS id FROM practice_session_vocabulary sv
       JOIN practice_sessions s ON s.id = sv.session_id
       WHERE sv.session_id = ? AND s.user_id = ?`,
    )
    .all(sessionId, userId) as Array<{ id: string }>;
  if (rows.length === 0) return undefined;
  return new Set(rows.map((row) => row.id));
}
