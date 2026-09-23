import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { commitVocabularyImport } from './repositories.js';
import { buildServer } from './server.js';

async function register(server: ReturnType<typeof buildServer>, username: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username, password: 'a-secure-password' },
  });
  expect(response.statusCode).toBe(201);
  return String(response.headers['set-cookie']);
}

describe('backend integration workflows', () => {
  it('covers account, authorization, import, practice, dashboard, settings, and logout', async () => {
    const database = openDatabase();
    const server = buildServer(database);
    const learnerCookie = await register(server, 'learner');

    const duplicate = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'LEARNER', password: 'a-secure-password' },
    });
    expect(duplicate.statusCode).toBe(409);

    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'learner', password: 'a-secure-password' },
    });
    expect(login.statusCode).toBe(200);
    const loggedInCookie = String(login.headers['set-cookie']);

    const unauthorizedPreview = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/preview',
      headers: { cookie: learnerCookie },
      payload: { content: '[{"english":"hello","german":"hallo"}]' },
    });
    expect(unauthorizedPreview.statusCode).toBe(403);

    database.prepare("UPDATE users SET role = 'administrator' WHERE username = ?").run('learner');
    const preview = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/preview',
      headers: { cookie: loggedInCookie },
      payload: { content: '[{"english":"hello","german":"hallo; guten Tag"}]' },
    });
    expect(preview.statusCode).toBe(200);

    const committed = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/import',
      headers: { cookie: loggedInCookie },
      payload: {
        confirm: true,
        sourceName: 'integration.json',
        content: '[{"english":"hello","german":"hallo; guten Tag"}]',
      },
    });
    expect(committed.statusCode).toBe(201);

    const history = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/vocabulary/imports',
      headers: { cookie: loggedInCookie },
    });
    expect(history.statusCode).toBe(200);
    expect(history.json().imports[0]).toMatchObject({ status: 'committed', recordCount: 1 });

    const question = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question?direction=english-to-german',
      headers: { cookie: loggedInCookie },
    });
    expect(question.statusCode).toBe(200);
    const answer = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/answer',
      headers: { cookie: loggedInCookie },
      payload: {
        vocabularyEntryId: question.json().question.vocabularyEntryId,
        direction: 'english-to-german',
        prompt: 'hello',
        submittedAnswer: 'hallo',
      },
    });
    expect(answer.json().result).toMatchObject({ correct: true, scoreDelta: 10 });

    const settings = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { cookie: loggedInCookie },
      payload: {
        direction: 'german-to-english',
        sessionLength: 5,
        repetitionPreference: 'errors-first',
      },
    });
    expect(settings.statusCode).toBe(200);
    const dashboard = await server.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { cookie: loggedInCookie },
    });
    expect(dashboard.json().dashboard).toMatchObject({
      totalAttempts: 1,
      totalPoints: 10,
      accuracy: 1,
    });

    const logout = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: loggedInCookie },
    });
    expect(logout.statusCode).toBe(204);
    const protectedAfterLogout = await server.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { cookie: loggedInCookie },
    });
    expect(protectedAfterLogout.statusCode).toBe(401);
    await server.close();
  });

  it('rolls back a failed vocabulary import without partial data', () => {
    const database = openDatabase();
    database
      .prepare(
        'INSERT INTO users (id, username, password_hash, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        'admin-1',
        'admin',
        'test-hash',
        'administrator',
        '2026-09-23T00:00:00.000Z',
        '2026-09-23T00:00:00.000Z',
      );
    expect(() =>
      commitVocabularyImport(
        database,
        'admin-1',
        [
          {
            english: 'hello',
            phonetics: undefined,
            german: 'hallo',
            alternatives: ['hallo', 'hallo'],
          },
        ],
        'broken.json',
        '2026-09-23T00:00:00.000Z',
      ),
    ).toThrow();
    expect(database.prepare('SELECT COUNT(*) AS count FROM vocabulary_entries').get()).toEqual({
      count: 0,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM vocabulary_imports').get()).toEqual({
      count: 0,
    });
  });
});
