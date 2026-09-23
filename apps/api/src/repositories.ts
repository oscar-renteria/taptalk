import type { DashboardSummary, PracticeDirection, UserPreferences } from '@taptalk/shared';
import type { SqliteDatabase } from './database.js';
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
  database
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(user.id, user.username, user.passwordHash, user.role, user.createdAt, user.updatedAt);
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
      answerStatement.run(
        crypto.randomUUID(),
        entry.id,
        answer,
        answer.normalize('NFKC').trim().toLocaleLowerCase(),
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
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
        answerStatement.run(
          crypto.randomUUID(),
          entryId,
          answer,
          answer.normalize('NFKC').trim().toLocaleLowerCase(),
        );
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
    throw error;
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
  },
): void {
  database
    .prepare(
      `INSERT INTO learning_attempts
       (id, user_id, vocabulary_entry_id, direction, prompt, submitted_answer, normalized_answer,
        correct, score_delta, matching_reason, attempted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
