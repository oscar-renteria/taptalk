import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import {
  getDashboardSummary,
  insertUser,
  recordAttempt,
  upsertVocabulary,
} from './repositories.js';

describe('dashboard summaries', () => {
  it('isolates users and bounds recent activity to ten records', () => {
    const database = openDatabase();
    const now = '2026-09-23T00:00:00.000Z';
    for (const id of ['user-1', 'user-2']) {
      insertUser(database, {
        id,
        username: id,
        passwordHash: 'test-hash',
        role: 'user',
        createdAt: now,
        updatedAt: now,
      });
    }
    upsertVocabulary(
      database,
      {
        id: 'entry-1',
        english: 'hello',
        phonetics: null,
        germanDisplay: 'hallo',
        answers: ['hallo'],
      },
      now,
    );
    for (let index = 0; index < 12; index += 1) {
      recordAttempt(database, {
        id: `attempt-${index}`,
        userId: 'user-1',
        vocabularyEntryId: 'entry-1',
        direction: 'english-to-german',
        prompt: 'hello',
        submittedAnswer: index === 0 ? 'hallo' : 'falsch',
        normalizedAnswer: index === 0 ? 'hallo' : 'falsch',
        correct: index === 0,
        scoreDelta: index === 0 ? 10 : 0,
        matchingReason: index === 0 ? 'exact-match' : 'incorrect',
        attemptedAt: `2026-09-23T00:00:${String(index).padStart(2, '0')}.000Z`,
      });
    }
    recordAttempt(database, {
      id: 'other-user-attempt',
      userId: 'user-2',
      vocabularyEntryId: 'entry-1',
      direction: 'english-to-german',
      prompt: 'hello',
      submittedAnswer: 'hallo',
      normalizedAnswer: 'hallo',
      correct: true,
      scoreDelta: 10,
      matchingReason: 'exact-match',
      attemptedAt: now,
    });

    const firstUser = getDashboardSummary(database, 'user-1');
    const secondUser = getDashboardSummary(database, 'user-2');
    expect(firstUser.totalAttempts).toBe(12);
    expect(firstUser.recentActivity).toHaveLength(10);
    expect(firstUser.repeatedErrorWords).toEqual(['hello']);
    expect(secondUser).toMatchObject({ totalAttempts: 1, totalPoints: 10, accuracy: 1 });
  });
});
