import { beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from './database.js';
import { getExamResult } from './repositories.js';
import { correctAnswerFor, type ReviewEntry } from './review.js';

const now = '2026-01-01T00:00:00.000Z';

/** The entry from the bug report: the two sides are distinct strings. */
const ENTRY: ReviewEntry = { english: 'That is', germanDisplay: 'Das (hier) ist' };

describe('correctAnswerFor', () => {
  it('owes the German for an English -> German question', () => {
    // Question: That is  ->  Correct answer: Das (hier) ist
    expect(correctAnswerFor('english-to-german', ENTRY, 'That is')).toBe('Das (hier) ist');
  });

  it('owes the English for a German -> English question', () => {
    // Question: Das (hier) ist  ->  Correct answer: That is
    expect(correctAnswerFor('german-to-english', ENTRY, 'Das (hier) ist')).toBe('That is');
  });

  it('never returns the prompt it was given as the expected answer', () => {
    for (const direction of ['english-to-german', 'german-to-english'] as const) {
      const prompt = direction === 'english-to-german' ? ENTRY.english : ENTRY.germanDisplay;
      expect(correctAnswerFor(direction, ENTRY, prompt)).not.toBe(prompt);
    }
  });

  it('falls back to the prompt when the vocabulary entry is gone', () => {
    expect(correctAnswerFor('english-to-german', undefined, 'orphan prompt')).toBe('orphan prompt');
  });
});

/**
 * The persisted review expresses the same rule in SQL rather than calling
 * `correctAnswerFor`, because it reads straight from `learning_attempts`. These
 * cases pin the two to the same answer so they cannot drift apart again: the bug
 * this guards against was exactly that divergence, with the guest review correct
 * and the stored review repeating the question.
 */
describe('the stored exam review agrees with the rule', () => {
  let database: SqliteDatabase;
  let sessionCount = 0;

  beforeEach(() => {
    database = openDatabase(':memory:');
    sessionCount = 0;
    database
      .prepare(
        'INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('learner', 'learner', 'hash', 'user', now, now);
    database
      .prepare(
        'INSERT INTO vocabulary_entries (id, english, phonetics, german_display, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)',
      )
      .run('entry-1', ENTRY.english, ENTRY.germanDisplay, now, now);
  });

  /** Records one finished attempt and reads the review the learner would see. */
  function review(direction: 'english-to-german' | 'german-to-english') {
    // Unique per call so one test can play both directions against one database.
    const run = `${direction}-${++sessionCount}`;
    database
      .prepare(
        `INSERT INTO practice_sessions (id, user_id, direction, question_count, status, started_at, ended_at, kind)
         VALUES (?, 'learner', ?, 1, 'completed', ?, ?, 'exam')`,
      )
      .run(run, direction, now, now);
    // `prompt` is the side shown as the question, which is what the selection
    // policy resolves from the direction.
    const prompt = direction === 'english-to-german' ? ENTRY.english : ENTRY.germanDisplay;
    database
      .prepare(
        `INSERT INTO learning_attempts
           (id, user_id, vocabulary_entry_id, direction, prompt, submitted_answer,
            normalized_answer, correct, score_delta, matching_reason, attempted_at, practice_session_id)
         VALUES (?, 'learner', 'entry-1', ?, ?, 'definitely wrong', 'definitely wrong',
                 0, 0, 'incorrect', ?, ?)`,
      )
      .run(`attempt-${run}`, direction, prompt, now, run);
    return getExamResult(database, 'learner', run)!.questions[0]!;
  }

  it('English -> German shows the German prompt and the English correct answer', () => {
    const item = review('english-to-german');
    expect(item.prompt).toBe('That is');
    expect(item.correctAnswer).toBe('Das (hier) ist');
    expect(item.correctAnswer).not.toBe(item.prompt);
  });

  it('German -> English shows the German prompt and the English correct answer', () => {
    // This is the reported bug: the review used to print the prompt back here.
    const item = review('german-to-english');
    expect(item.prompt).toBe('Das (hier) ist');
    expect(item.correctAnswer).toBe('That is');
    expect(item.correctAnswer).not.toBe(item.prompt);
  });

  it('matches the pure function for both directions', () => {
    for (const direction of ['english-to-german', 'german-to-english'] as const) {
      const item = review(direction);
      const prompt = direction === 'english-to-german' ? ENTRY.english : ENTRY.germanDisplay;
      expect(item.correctAnswer).toBe(correctAnswerFor(direction, ENTRY, prompt));
    }
  });

  it('leaves scoring untouched', () => {
    review('english-to-german');
    const { id } = database.prepare('SELECT id FROM practice_sessions').get() as {
      id: string;
    };
    const result = getExamResult(database, 'learner', id)!;
    expect(result.correctCount).toBe(0);
    expect(result.incorrectCount).toBe(1);
    expect(result.score).toBe(0);
  });
});
