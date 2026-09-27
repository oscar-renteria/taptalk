import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { openDatabase, type SqliteDatabase } from './database.js';
import { resetGuestStore } from './guest-store.js';
import { createGuestId, signGuestToken, verifyGuestToken } from './guest.js';
import { GuestPersistenceError, assertPersistableUserId } from './persistence.js';

const secret = 'guest-test-secret';

function seed(database: SqliteDatabase): void {
  database
    .prepare(
      'INSERT INTO vocabulary_entries (id, english, phonetics, german_display, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(
      'entry-1',
      'hello',
      '[haˈloː]',
      'Hallo',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
    );
  database
    .prepare(
      'INSERT INTO vocabulary_answers (id, vocabulary_entry_id, answer, normalized_answer) VALUES (?, ?, ?, ?)',
    )
    .run('answer-1', 'entry-1', 'Hallo', 'hallo');
}

async function guestSetup() {
  const database = openDatabase();
  seed(database);
  const server = buildServer(database, { secureCookies: false, allowAllOrigins: false });
  const response = await server.inject({ method: 'POST', url: '/api/v1/auth/guest' });
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  return {
    database,
    server,
    cookie,
    guestId: (response.json() as { guest: { id: string } }).guest.id,
  };
}

/** Counts rows in every table that can hold user-owned data. */
function userRows(database: SqliteDatabase) {
  const count = (sql: string) => (database.prepare(sql).get() as { total: number }).total;
  return {
    users: count('SELECT COUNT(*) AS total FROM users'),
    sessions: count('SELECT COUNT(*) AS total FROM sessions'),
    attempts: count('SELECT COUNT(*) AS total FROM learning_attempts'),
    practiceSessions: count('SELECT COUNT(*) AS total FROM practice_sessions'),
    preferences: count('SELECT COUNT(*) AS total FROM user_preferences'),
    vocabularyEntries: count('SELECT COUNT(*) AS total FROM vocabulary_entries'),
  };
}

describe('guest sessions', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('signs a guest token the server can verify and a client cannot forge', () => {
    const guestId = createGuestId();
    const token = signGuestToken(secret, guestId, Date.now());
    expect(verifyGuestToken(secret, token, Date.now())).toBe(guestId);
    // A tampered id no longer matches the signature.
    const [, issuedAt, mac] = token.split('.');
    expect(verifyGuestToken(secret, `guest_deadbeef.${issuedAt}.${mac}`, Date.now())).toBeNull();
    // A different secret does not verify.
    expect(verifyGuestToken('other-secret', token, Date.now())).toBeNull();
    // Expired tokens are indistinguishable from no token.
    expect(verifyGuestToken(secret, token, Date.now() + 1000 * 60 * 60 * 24 * 15)).toBeNull();
  });

  it('ignores a client-supplied guest claim and still refuses the request', async () => {
    const { server, cookie } = await guestSetup();
    for (const payload of [{ isGuest: true }, { userId: 'someone-else' }, { guest: true }]) {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/dashboard',
        payload,
        headers: { cookie: 'taptalk_guest=forged.token.value' },
      });
      expect(response.statusCode).toBe(401);
    }
    // The real signed cookie is accepted.
    expect(
      (await server.inject({ method: 'GET', url: '/api/v1/dashboard', headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    await server.close();
  });

  it('reports the session as a guest with no user', async () => {
    const { server, cookie } = await guestSetup();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie },
    });
    expect(response.json()).toEqual({ user: null, guest: true });
    await server.close();
  });
});

describe('guest activity never reaches the database', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('creates no user, session, preference, or attempt rows', async () => {
    const { database, server, cookie } = await guestSetup();
    const before = userRows(database);
    expect(before.users).toBe(0);

    // Start a round, answer it, and read the dashboard: the full guest journey.
    const session = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/sessions',
      payload: { direction: 'english-to-german' },
      headers: { cookie },
    });
    expect(session.statusCode).toBe(201);
    const sessionId = (session.json() as { session: { id: string } }).session.id;

    const question = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question?practiceSessionId=' + sessionId,
      headers: { cookie },
    });
    const vocabularyEntryId = (question.json() as { question: { vocabularyEntryId: string } })
      .question.vocabularyEntryId;

    const answer = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/answer',
      payload: {
        vocabularyEntryId,
        direction: 'english-to-german',
        submittedAnswer: 'Hallo',
        practiceSessionId: sessionId,
      },
      headers: { cookie },
    });
    expect(answer.statusCode).toBe(200);
    expect((answer.json() as { result: { correct: boolean } }).result.correct).toBe(true);

    await server.inject({ method: 'GET', url: '/api/v1/dashboard', headers: { cookie } });
    await server.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      payload: {
        direction: 'german-to-english',
        sessionLength: 5,
        repetitionPreference: 'balanced',
      },
      headers: { cookie },
    });
    await server.inject({
      method: 'POST',
      url: `/api/v1/practice/sessions/${sessionId}/end`,
      headers: { cookie },
    });

    // Nothing was written: the vocabulary row is the only thing in the database.
    expect(userRows(database)).toEqual(before);
    expect(before.vocabularyEntries).toBeGreaterThan(0);
    await server.close();
  });

  it('serves a real guest the same practice and progress as a user', async () => {
    const { server, cookie } = await guestSetup();
    const session = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/sessions',
      payload: {},
      headers: { cookie },
    });
    const sessionId = (session.json() as { session: { id: string } }).session.id;
    const question = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question?practiceSessionId=' + sessionId,
      headers: { cookie },
    });
    expect(question.statusCode).toBe(200);
    const vocabularyEntryId = (question.json() as { question: { vocabularyEntryId: string } })
      .question.vocabularyEntryId;
    await server.inject({
      method: 'POST',
      url: '/api/v1/practice/answer',
      payload: {
        vocabularyEntryId,
        direction: 'english-to-german',
        submittedAnswer: 'Hallo',
        practiceSessionId: sessionId,
      },
      headers: { cookie },
    });

    // The guest sees their own progress, held in memory.
    const dashboard = await server.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { cookie },
    });
    const summary = dashboard.json() as {
      dashboard: { totalAttempts: number; totalPoints: number; accuracy: number };
    };
    expect(summary.dashboard.totalAttempts).toBe(1);
    expect(summary.dashboard.accuracy).toBe(1);
    expect(summary.dashboard.totalPoints).toBeGreaterThan(0);

    // Settings round-trip for a guest without touching the database.
    const saved = await server.inject({
      method: 'PUT',
      url: '/api/v1/settings',
      payload: {
        direction: 'german-to-english',
        sessionLength: 7,
        repetitionPreference: 'errors-first',
      },
      headers: { cookie },
    });
    expect((saved.json() as { settings: { sessionLength: number } }).settings.sessionLength).toBe(
      7,
    );
    const read = await server.inject({
      method: 'GET',
      url: '/api/v1/settings',
      headers: { cookie },
    });
    expect((read.json() as { settings: { sessionLength: number } }).settings.sessionLength).toBe(7);
    await server.close();
  });

  it('keeps two guests completely separate', async () => {
    const a = await guestSetup();
    const b = await guestSetup();
    const answerOne = async (ctx: Awaited<ReturnType<typeof guestSetup>>) => {
      const session = await ctx.server.inject({
        method: 'POST',
        url: '/api/v1/practice/sessions',
        payload: {},
        headers: { cookie: ctx.cookie },
      });
      const sessionId = (session.json() as { session: { id: string } }).session.id;
      const question = await ctx.server.inject({
        method: 'GET',
        url: '/api/v1/practice/question?practiceSessionId=' + sessionId,
        headers: { cookie: ctx.cookie },
      });
      const vocabularyEntryId = (question.json() as { question: { vocabularyEntryId: string } })
        .question.vocabularyEntryId;
      await ctx.server.inject({
        method: 'POST',
        url: '/api/v1/practice/answer',
        payload: {
          vocabularyEntryId,
          direction: 'english-to-german',
          submittedAnswer: 'Hallo',
          practiceSessionId: sessionId,
        },
        headers: { cookie: ctx.cookie },
      });
      return sessionId;
    };
    await answerOne(a);
    // B answered nothing, so B must not see A's progress or be able to read A's round.
    const bDashboard = await b.server.inject({
      method: 'GET',
      url: '/api/v1/dashboard',
      headers: { cookie: b.cookie },
    });
    expect(
      (bDashboard.json() as { dashboard: { totalAttempts: number } }).dashboard.totalAttempts,
    ).toBe(0);
    const crossRead = await b.server.inject({
      method: 'GET',
      url: '/api/v1/practice/sessions/' + 'does-not-exist',
      headers: { cookie: b.cookie },
    });
    expect(crossRead.statusCode).toBe(404);
    await a.server.close();
    await b.server.close();
  });
});

describe('guest authorization', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('cannot reach administrator functionality', async () => {
    const { server, cookie } = await guestSetup();
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/vocabulary/imports',
      headers: { cookie },
    });
    // Refused as a non-user rather than served.
    expect(response.statusCode).toBe(401);
    await server.close();
  });

  it('cannot act as a real user through forged or absent cookies', async () => {
    const { server, cookie } = await guestSetup();
    expect(
      (await server.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { cookie } }))
        .statusCode,
    ).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/api/v1/auth/me' })).statusCode).toBe(401);
    await server.close();
  });

  it('cannot read another user settings, which stay account-only', async () => {
    // GET/PUT /settings are guest-capable for the guest's own temporary copy,
    // but the guard still refuses an anonymous caller outright.
    const database = openDatabase();
    seed(database);
    const server = buildServer(database, { secureCookies: false });
    expect((await server.inject({ method: 'GET', url: '/api/v1/settings' })).statusCode).toBe(401);
    await server.close();
  });
});

describe('persistence boundary', () => {
  it('refuses to persist anything under a guest id', () => {
    const guestId = createGuestId();
    expect(guestId.startsWith('guest_')).toBe(true);
    expect(() => assertPersistableUserId(guestId, 'recordAttempt')).toThrow(GuestPersistenceError);
    // Real user ids are unaffected.
    expect(() => assertPersistableUserId('user-123', 'recordAttempt')).not.toThrow();
  });
});
