import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from './database.js';
import { commitVocabularyImport, setUserRole } from './repositories.js';
import { buildServer } from './server.js';

let database: SqliteDatabase;
let server: ReturnType<typeof buildServer>;

async function register(username: string): Promise<string> {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username, password: 'a-secure-password' },
  });
  expect(response.statusCode).toBe(201);
  return String(response.headers['set-cookie']);
}

async function setSessionLength(cookie: string, sessionLength: number): Promise<void> {
  const response = await server.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    headers: { cookie },
    payload: { direction: 'english-to-german', sessionLength, repetitionPreference: 'balanced' },
  });
  expect(response.statusCode).toBe(200);
}

async function startSession(cookie: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/practice/sessions',
    headers: { cookie },
    payload: {},
  });
  expect(response.statusCode).toBe(201);
  return response.json().session as { id: string; questionCount: number; status: string };
}

async function answer(cookie: string, practiceSessionId: string, submittedAnswer: string) {
  const question = await server.inject({
    method: 'GET',
    url: '/api/v1/practice/question?direction=english-to-german',
    headers: { cookie },
  });
  return server.inject({
    method: 'POST',
    url: '/api/v1/practice/answer',
    headers: { cookie },
    payload: {
      ...question.json().question,
      direction: 'english-to-german',
      submittedAnswer,
      practiceSessionId,
    },
  });
}

function endSession(cookie: string, sessionId: string) {
  return server.inject({
    method: 'POST',
    url: `/api/v1/practice/sessions/${sessionId}/end`,
    headers: { cookie },
  });
}

beforeEach(() => {
  database = openDatabase();
  server = buildServer(database);
  const now = '2026-09-23T00:00:00.000Z';
  database
    .prepare(
      `INSERT INTO users (id, username, password_hash, role, created_at, updated_at)
       VALUES ('admin-1', 'seed-admin', 'unused', 'administrator', ?, ?)`,
    )
    .run(now, now);
  commitVocabularyImport(
    database,
    'admin-1',
    [{ english: 'hello', phonetics: undefined, german: 'hallo', alternatives: ['hallo'] }],
    'seed.json',
    now,
  );
});

afterEach(async () => {
  await server.close();
});

describe('practice session lifecycle', () => {
  it('uses the preferred session length and summarizes a completed session', async () => {
    const cookie = await register('learner');
    await setSessionLength(cookie, 2);
    const session = await startSession(cookie);
    expect(session).toMatchObject({ questionCount: 2, status: 'active', answeredCount: 0 });
    expect(session).not.toHaveProperty('userId');

    const first = await answer(cookie, session.id, 'hallo');
    expect(first.json().session).toEqual({ id: session.id, answeredCount: 1, questionCount: 2 });
    await answer(cookie, session.id, 'wrong');
    const full = await answer(cookie, session.id, 'hallo');
    expect(full.statusCode).toBe(409);
    expect(full.json().error.code).toBe('SESSION_NOT_ACTIVE');

    const ended = await endSession(cookie, session.id);
    expect(ended.statusCode).toBe(200);
    expect(ended.json().session).toMatchObject({
      status: 'completed',
      questionCount: 2,
      answeredCount: 2,
      correctCount: 1,
      incorrectCount: 1,
      pointsEarned: 10,
      accuracy: 0.5,
      wordsToPractice: ['hello'],
    });

    const results = await server.inject({
      method: 'GET',
      url: `/api/v1/practice/sessions/${session.id}`,
      headers: { cookie },
    });
    expect(results.json().session).toEqual(ended.json().session);
  });

  it('marks a session ended early as abandoned, including the zero-question case', async () => {
    const cookie = await register('learner');
    const session = await startSession(cookie);
    const ended = await endSession(cookie, session.id);
    expect(ended.json().session).toMatchObject({
      status: 'abandoned',
      answeredCount: 0,
      correctCount: 0,
      incorrectCount: 0,
      pointsEarned: 0,
      accuracy: 0,
      wordsToPractice: [],
    });
    const late = await answer(cookie, session.id, 'hallo');
    expect(late.statusCode).toBe(409);
  });

  it('abandons the previous active session when a new one starts', async () => {
    const cookie = await register('learner');
    const first = await startSession(cookie);
    await answer(cookie, first.id, 'hallo');
    await startSession(cookie);
    const previous = await server.inject({
      method: 'GET',
      url: `/api/v1/practice/sessions/${first.id}`,
      headers: { cookie },
    });
    expect(previous.json().session).toMatchObject({ status: 'abandoned', answeredCount: 1 });
  });

  it('isolates sessions between users and rejects invalid requests', async () => {
    const owner = await register('owner');
    const other = await register('other');
    const session = await startSession(owner);

    for (const response of [
      await server.inject({
        method: 'GET',
        url: `/api/v1/practice/sessions/${session.id}`,
        headers: { cookie: other },
      }),
      await endSession(other, session.id),
      await answer(other, session.id, 'hallo'),
    ]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('SESSION_NOT_FOUND');
    }

    const anonymous = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/sessions',
      payload: {},
    });
    expect(anonymous.statusCode).toBe(401);
    const invalidDirection = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/sessions',
      headers: { cookie: owner },
      payload: { direction: 'sideways' },
    });
    expect(invalidDirection.statusCode).toBe(400);
  });

  it('refuses to start a session without vocabulary', async () => {
    database.exec('DELETE FROM vocabulary_answers; DELETE FROM vocabulary_entries;');
    const cookie = await register('learner');
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/sessions',
      headers: { cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NO_VOCABULARY');
  });
});

describe('session scoring', () => {
  it('reduces points for a word after earlier errors in the same session only', async () => {
    const cookie = await register('learner');
    await setSessionLength(cookie, 4);
    const session = await startSession(cookie);
    const scores: number[] = [];
    for (const submitted of ['wrong', 'wrong', 'hallo', 'hallo']) {
      scores.push((await answer(cookie, session.id, submitted)).json().result.scoreDelta);
    }
    expect(scores).toEqual([0, 0, 6, 6]);
    const summary = (await endSession(cookie, session.id)).json().session;
    expect(summary.pointsEarned).toBe(12);

    // A new session starts from a clean slate for the same word.
    const next = await startSession(cookie);
    expect((await answer(cookie, next.id, 'hallo')).json().result.scoreDelta).toBe(10);
  });

  it('ignores client-supplied scores and scores attempts outside a session without penalty', async () => {
    const cookie = await register('learner');
    const question = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question?direction=english-to-german',
      headers: { cookie },
    });
    const submit = (submittedAnswer: string) =>
      server.inject({
        method: 'POST',
        url: '/api/v1/practice/answer',
        headers: { cookie },
        payload: {
          ...question.json().question,
          direction: 'english-to-german',
          submittedAnswer,
          scoreDelta: 1000,
          correct: true,
        },
      });
    expect((await submit('wrong')).json().result).toMatchObject({ correct: false, scoreDelta: 0 });
    expect((await submit('hallo')).json().result).toMatchObject({ correct: true, scoreDelta: 10 });
  });
});

describe('administrator provisioning', () => {
  it('changes the role of an existing account case-insensitively', async () => {
    const cookie = await register('future-admin');
    expect(setUserRole(database, 'FUTURE-ADMIN', 'administrator', '2026-09-23T00:00:00.000Z')).toBe(
      true,
    );
    const history = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/vocabulary/imports',
      headers: { cookie },
    });
    expect(history.statusCode).toBe(200);
    expect(setUserRole(database, 'missing', 'administrator', '2026-09-23T00:00:00.000Z')).toBe(
      false,
    );
  });
});

describe('question selection over HTTP', () => {
  function seedWords(words: Array<[string, string]>) {
    commitVocabularyImport(
      database,
      'admin-1',
      words.map(([english, german]) => ({
        english,
        phonetics: undefined,
        german,
        alternatives: [german],
      })),
      'more.json',
      '2026-09-23T00:00:00.000Z',
    );
  }

  it('varies questions, never repeats the previous word, and explains the choice', async () => {
    seedWords([
      ['tree', 'Baum'],
      ['house', 'Haus'],
    ]);
    const cookie = await register('learner');
    await setSessionLength(cookie, 20);
    const session = await startSession(cookie);
    const asked: string[] = [];
    for (let index = 0; index < 12; index += 1) {
      const question = await server.inject({
        method: 'GET',
        url: `/api/v1/practice/question?practiceSessionId=${session.id}`,
        headers: { cookie },
      });
      const body = question.json().question;
      expect(['new-word', 'needs-practice', 'review']).toContain(body.selectionReason);
      asked.push(body.prompt);
      await server.inject({
        method: 'POST',
        url: '/api/v1/practice/answer',
        headers: { cookie },
        payload: { ...body, submittedAnswer: 'wrong', practiceSessionId: session.id },
      });
    }
    expect(new Set(asked).size).toBeGreaterThan(1);
    for (let index = 1; index < asked.length; index += 1) {
      expect(asked[index], `question ${index}`).not.toBe(asked[index - 1]);
    }
  });

  it('resolves a random direction per question and uses the session direction', async () => {
    const cookie = await register('learner');
    const directions = new Set<string>();
    for (let index = 0; index < 20; index += 1) {
      const question = await server.inject({
        method: 'GET',
        url: '/api/v1/practice/question?direction=random',
        headers: { cookie },
      });
      directions.add(question.json().question.direction);
    }
    expect(directions).toEqual(new Set(['english-to-german', 'german-to-english']));

    const session = (
      await server.inject({
        method: 'POST',
        url: '/api/v1/practice/sessions',
        headers: { cookie },
        payload: { direction: 'german-to-english' },
      })
    ).json().session;
    const inSession = await server.inject({
      method: 'GET',
      url: `/api/v1/practice/question?practiceSessionId=${session.id}&direction=english-to-german`,
      headers: { cookie },
    });
    expect(inSession.json().question).toMatchObject({
      direction: 'german-to-english',
      prompt: 'hallo',
    });
  });

  it('rejects unknown or ended sessions and skips entries without answers', async () => {
    const cookie = await register('learner');
    const unknown = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question?practiceSessionId=missing',
      headers: { cookie },
    });
    expect(unknown.statusCode).toBe(404);
    const session = await startSession(cookie);
    await endSession(cookie, session.id);
    const ended = await server.inject({
      method: 'GET',
      url: `/api/v1/practice/question?practiceSessionId=${session.id}`,
      headers: { cookie },
    });
    expect(ended.statusCode).toBe(409);

    database.exec('DELETE FROM vocabulary_answers');
    const unanswerable = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question',
      headers: { cookie },
    });
    expect(unanswerable.statusCode).toBe(404);
    expect(unanswerable.json().error.code).toBe('NO_VOCABULARY');
  });
});
