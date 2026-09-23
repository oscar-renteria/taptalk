import { describe, expect, it } from 'vitest';
import {
  apiErrorSchema,
  dashboardSummarySchema,
  practiceDirectionSchema,
  projectName,
  publicUserSchema,
  registrationErrors,
  registrationSchema,
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

describe('credential policy', () => {
  it('accepts a valid registration and trims the username', () => {
    expect(
      registrationSchema.parse({ username: '  learner ', password: 'a-secure-password' }),
    ).toEqual({ username: 'learner', password: 'a-secure-password' });
    expect(registrationErrors({ username: 'Émile_2', password: 'grüne-Äpfel' })).toEqual([]);
  });

  it.each([
    [{ username: 'a', password: 'a-secure-password' }, 'username', 'at least 2'],
    [{ username: 'x'.repeat(33), password: 'a-secure-password' }, 'username', 'at most 32'],
    [{ username: 'has space', password: 'a-secure-password' }, 'username', 'letters, numbers'],
    [{ username: 'learner', password: 'short' }, 'password', 'at least 8'],
    [{ username: 'learner', password: 'x'.repeat(129) }, 'password', 'at most 128'],
    [{ username: 'learner', password: 'Password' }, 'password', 'too common'],
    [{ username: 'learner', password: 'aaaabbbb' }, 'password', '4 different'],
    [{ username: 'learner', password: 'my-learner-pw' }, 'password', 'must not contain'],
    [{ username: 42, password: null }, 'username', ''],
  ])('rejects %j with a field-level message', (input, field, message) => {
    const errors = registrationErrors(input);
    expect(errors.some((error) => error.field === field && error.message.includes(message))).toBe(
      true,
    );
  });

  it('never echoes the submitted password in error messages', () => {
    const errors = registrationErrors({ username: 'learner', password: 'learner123' });
    expect(JSON.stringify(errors)).not.toContain('learner123');
  });
});
