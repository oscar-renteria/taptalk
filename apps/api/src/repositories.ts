import type { DashboardSummary, PracticeDirection, UserPreferences } from '@taptalk/shared';
import type { SqliteDatabase } from './database.js';
import { normalizeAnswer } from './matching.js';
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
  session: { id: string; userId: string; direction: PracticeDirection; questionCount: number },
  now: string,
): PracticeSessionRecord {
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
        `INSERT INTO practice_sessions (id, user_id, direction, question_count, status, started_at)
         VALUES (?, ?, ?, ?, 'active', ?)`,
      )
      .run(session.id, session.userId, session.direction, session.questionCount, now);
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
              (SELECT COUNT(*) FROM learning_attempts a WHERE a.practice_session_id = s.id) AS answeredCount
       FROM practice_sessions s WHERE s.id = ? AND s.user_id = ?`,
    )
    .get(sessionId, userId) as PracticeSessionRecord | undefined;
  return row ? { ...row, answeredCount: Number(row.answeredCount) } : undefined;
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
