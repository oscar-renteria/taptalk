import { describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { upsertVocabulary } from './repositories.js';
import { buildServer } from './server.js';

describe('health and readiness endpoints', () => {
  it('reports an operational API', async () => {
    const server = buildServer();
    const response = await server.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await server.close();
  });

  it('reports not ready until the readiness state is enabled', async () => {
    let ready = false;
    const server = buildServer(undefined, { isReady: () => ready });
    const notReady = await server.inject({ method: 'GET', url: '/ready' });
    expect(notReady.statusCode).toBe(503);
    expect(notReady.json()).toEqual({ status: 'not_ready' });

    ready = true;
    const readyResponse = await server.inject({ method: 'GET', url: '/ready' });
    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toEqual({ status: 'ready' });
    await server.close();
  });

  it('reports not ready when the database cannot be queried', async () => {
    const database = openDatabase();
    const server = buildServer(database);
    database.close();
    const response = await server.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
    await server.close();
  });

  it('registers, authenticates, and protects the current-user endpoint', async () => {
    const server = buildServer();
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'learner', password: 'a-secure-password' },
    });
    expect(registration.statusCode).toBe(201);
    const cookie = registration.headers['set-cookie'];
    expect(cookie).toContain('taptalk_session=');

    const currentUser = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: String(cookie) },
    });
    expect(currentUser.statusCode).toBe(200);
    expect(currentUser.json().user).toMatchObject({ username: 'learner', role: 'user' });

    const invalidLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'learner', password: 'wrong-password' },
    });
    expect(invalidLogin.statusCode).toBe(401);
    await server.close();
  });

  it('restricts vocabulary preview to administrators and does not mutate data', async () => {
    const database = openDatabase();
    const server = buildServer(database);
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'admin', password: 'a-secure-password' },
    });
    const cookie = String(registration.headers['set-cookie']);
    database.prepare("UPDATE users SET role = 'administrator' WHERE username = ?").run('admin');
    const preview = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/preview',
      headers: { cookie },
      payload: {
        sourceName: 'starter.json',
        content: '[{"english":"hello","german":"hallo; guten Tag"}]',
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().preview.valid).toHaveLength(1);
    expect(database.prepare('SELECT COUNT(*) AS count FROM vocabulary_entries').get()).toEqual({
      count: 0,
    });

    const unconfirmedImport = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/import',
      headers: { cookie },
      payload: { content: '[{"english":"hello","german":"hallo"}]' },
    });
    expect(unconfirmedImport.statusCode).toBe(400);
    const committedImport = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/import',
      headers: { cookie },
      payload: {
        sourceName: 'starter.json',
        confirm: true,
        content: '[{"english":"hello","german":"hallo; guten Tag"}]',
      },
    });
    expect(committedImport.statusCode).toBe(201);
    expect(database.prepare('SELECT COUNT(*) AS count FROM vocabulary_entries').get()).toEqual({
      count: 1,
    });
    expect(database.prepare('SELECT COUNT(*) AS count FROM vocabulary_answers').get()).toEqual({
      count: 2,
    });
    expect(database.prepare('SELECT status FROM vocabulary_imports').get()).toEqual({
      status: 'committed',
    });
    const importHistory = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/vocabulary/imports',
      headers: { cookie },
    });
    expect(importHistory.statusCode).toBe(200);
    expect(importHistory.json().imports).toHaveLength(1);

    const regularRegistration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'learner', password: 'a-secure-password' },
    });
    const forbidden = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/vocabulary/preview',
      headers: { cookie: String(regularRegistration.headers['set-cookie']) },
      payload: { content: '[{"english":"hello","german":"hallo"}]' },
    });
    expect(forbidden.statusCode).toBe(403);
    await server.close();
  });

  it('selects a protected question and records a server-scored answer', async () => {
    const database = openDatabase();
    upsertVocabulary(
      database,
      {
        id: 'entry-1',
        english: 'hello',
        phonetics: null,
        germanDisplay: 'hallo',
        answers: ['hallo'],
      },
      '2026-09-23T00:00:00.000Z',
    );
    const server = buildServer(database);
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'learner', password: 'a-secure-password' },
    });
    const cookie = String(registration.headers['set-cookie']);
    const defaultSettings = await server.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: { cookie },
    });
    expect(defaultSettings.statusCode).toBe(200);
    expect(defaultSettings.json().settings).toMatchObject({
      direction: 'random',
      sessionLength: 10,
    });
    const updatedSettings = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      headers: { cookie },
      payload: {
        direction: 'german-to-english',
        sessionLength: 5,
        repetitionPreference: 'errors-first',
      },
    });
    expect(updatedSettings.statusCode).toBe(200);
    expect(updatedSettings.json().settings).toMatchObject({
      direction: 'german-to-english',
      sessionLength: 5,
    });
    const savedDirectionQuestion = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question',
      headers: { cookie },
    });
    expect(savedDirectionQuestion.json().question).toMatchObject({
      direction: 'german-to-english',
      prompt: 'hallo',
    });
    const question = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question?direction=english-to-german',
      headers: { cookie },
    });
    expect(question.statusCode).toBe(200);
    expect(question.json().question).toMatchObject({
      vocabularyEntryId: 'entry-1',
      direction: 'english-to-german',
      prompt: 'hello',
    });
    const answer = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/answer',
      headers: { cookie },
      payload: {
        vocabularyEntryId: 'entry-1',
        direction: 'english-to-german',
        prompt: 'hello',
        submittedAnswer: 'Hallo!',
        scoreDelta: 999,
      },
    });
    expect(answer.statusCode).toBe(200);
    expect(answer.json().result).toMatchObject({ correct: true, scoreDelta: 10 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM learning_attempts').get()).toEqual({
      count: 1,
    });
    const dashboard = await server.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { cookie },
    });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().dashboard).toMatchObject({
      totalPoints: 10,
      totalAttempts: 1,
      accuracy: 1,
    });
    await server.close();
  });
});
