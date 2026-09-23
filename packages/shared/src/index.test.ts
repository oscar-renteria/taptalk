import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  dashboardSummarySchema,
  practiceDirectionSchema,
  projectName,
  publicUserSchema,
  userPreferencesSchema,
  vocabularyImportRecordSchema,
} from './index.js';

describe('shared package', () => {
  it('exports the project identity', () => {
    expect(projectName).toBe('TapTalk');
  });

  it('accepts valid shared contracts', () => {
    expect(
      publicUserSchema.parse({
        id: 'user-1',
        username: 'learner',
        role: 'user',
        createdAt: '2026-09-23T00:00:00.000Z',
      }),
    ).toMatchObject({ username: 'learner', role: 'user' });
    expect(vocabularyImportRecordSchema.parse({ english: 'hello', german: 'hallo' })).toEqual({
      english: 'hello',
      german: 'hallo',
    });
    expect(practiceDirectionSchema.parse('random')).toBe('random');
    expect(
      apiErrorSchema.parse({ error: { code: 'BAD_INPUT', message: 'Invalid input' } }),
    ).toEqual({
      error: { code: 'BAD_INPUT', message: 'Invalid input' },
    });
    expect(
      dashboardSummarySchema.parse({
        totalPoints: 3,
        totalAttempts: 2,
        accuracy: 0.5,
        recentActivity: [
          {
            attemptedAt: '2026-09-23T00:00:00.000Z',
            direction: 'english-to-german',
            correct: true,
          },
        ],
        repeatedErrorWords: ['house'],
      }),
    ).toHaveProperty('accuracy', 0.5);
  });

  it('rejects invalid or sensitive public data', () => {
    expect(() => vocabularyImportRecordSchema.parse({ english: '', german: 'hallo' })).toThrow();
    expect(() =>
      publicUserSchema.parse({ id: 'user-1', username: 'learner', passwordHash: 'secret' }),
    ).toThrow();
    expect(() => practiceDirectionSchema.parse('sideways')).toThrow();
    expect(() =>
      userPreferencesSchema.parse({
        direction: 'random',
        sessionLength: 0,
        repetitionPreference: 'balanced',
      }),
    ).toThrow();
  });

  it('accepts valid persisted practice settings', () => {
    expect(
      userPreferencesSchema.parse({
        direction: 'german-to-english',
        sessionLength: 5,
        repetitionPreference: 'errors-first',
      }),
    ).toEqual({
      direction: 'german-to-english',
      sessionLength: 5,
      repetitionPreference: 'errors-first',
    });
  });
});
