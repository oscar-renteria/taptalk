import { describe, expect, it } from 'vitest';
import { migrateDatabase, openDatabase } from './database.js';
import {
  ensurePreferences,
  findUserByUsername,
  insertUser,
  commitVocabularyImport,
  RepositoryError,
  upsertVocabulary,
} from './repositories.js';

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

  it('can open without applying migrations for an explicit migration phase', () => {
    const database = openDatabase(':memory:', { migrate: false });
    expect(() => database.prepare('SELECT id FROM schema_migrations').get()).toThrow();
    migrateDatabase(database);
    expect(database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get()).toEqual({
      count: 2,
    });
    database.close();
  });

  it('maps invalid repository operations to safe errors', () => {
    const database = openDatabase();
    const now = '2026-09-23T00:00:00.000Z';
    const user = {
      id: 'user-1',
      username: 'learner',
      passwordHash: 'hash',
      role: 'user' as const,
      createdAt: now,
      updatedAt: now,
    };
    insertUser(database, user);
    expect(() => insertUser(database, user)).toThrowError(RepositoryError);
    expect(() => insertUser(database, user)).toThrow(/conflicts with existing data/);
    expect(() =>
      upsertVocabulary(
        database,
        {
          id: 'entry-1',
          english: 'hello',
          phonetics: null,
          germanDisplay: 'hallo',
          answers: ['hallo', 'hallo'],
        },
        now,
      ),
    ).toThrow(/conflicts with existing data/);
    expect(database.prepare('SELECT COUNT(*) AS count FROM vocabulary_entries').get()).toEqual({
      count: 0,
    });
  });

  it('maps foreign-key failures without exposing SQLite details', () => {
    const database = openDatabase();
    expect(() =>
      commitVocabularyImport(
        database,
        'missing-user',
        [{ english: 'hello', phonetics: undefined, german: 'hallo', alternatives: ['hallo'] }],
        'missing-user.json',
        '2026-09-23T00:00:00.000Z',
      ),
    ).toThrowError(RepositoryError);
    expect(() =>
      commitVocabularyImport(
        database,
        'missing-user',
        [{ english: 'hello', phonetics: undefined, german: 'hallo', alternatives: ['hallo'] }],
        'missing-user.json',
        '2026-09-23T00:00:00.000Z',
      ),
    ).toThrow(/data constraint/);
  });
});
