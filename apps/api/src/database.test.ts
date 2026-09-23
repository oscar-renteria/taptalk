import { describe, expect, it } from 'vitest';
import { migrateDatabase, openDatabase } from './database.js';
import { ensurePreferences, findUserByUsername, insertUser } from './repositories.js';

describe('database foundation', () => {
  it('applies migrations idempotently and persists repository data', () => {
    const database = openDatabase();
    migrateDatabase(database);
    const now = '2026-09-23T00:00:00.000Z';
    insertUser(database, {
      id: 'user-1',
      username: 'learner',
      passwordHash: 'hash',
      role: 'user',
      createdAt: now,
      updatedAt: now,
    });
    ensurePreferences(database, 'user-1', now);

    expect(findUserByUsername(database, 'LEARNER')).toMatchObject({
      id: 'user-1',
      username: 'learner',
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM user_preferences').get()).toEqual({
      count: 1,
    });
  });
});
