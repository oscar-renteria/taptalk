import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, type SqliteDatabase } from './database.js';
import { buildServer } from './server.js';
import {
  commitVocabularyImport,
  endPracticeSession,
  ensurePreferences,
  insertUser,
  startPracticeSession,
} from './repositories.js';
import { hashPassword } from './auth.js';
import {
  buildSharePayload,
  createShareToken,
  hasScorableResult,
  isShareableStatus,
  isShareToken,
  sharePath,
} from './share.js';

const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
const PASSWORD = 'Correct-Horse-9';

describe('share domain rules', () => {
  it('creates unguessable, well-formed, distinct tokens', () => {
    const tokens = Array.from({ length: 200 }, () => createShareToken());
    expect(new Set(tokens).size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(TOKEN_SHAPE);
      expect(isShareToken(token)).toBe(true);
    }
  });

  it('never derives a token from a sequential id', () => {
    // Tokens must not be guessable from the order shares were created, so no token
    // may look like a counter or a small integer.
    for (const token of Array.from({ length: 50 }, () => createShareToken())) {
      expect(/^[0-9]+$/.test(token)).toBe(false);
      expect(token.length).toBe(43);
    }
  });

  it('rejects anything that is not exactly a generated token', () => {
    expect(isShareToken('')).toBe(false);
    expect(isShareToken('short')).toBe(false);
    expect(isShareToken('a'.repeat(44))).toBe(false);
    expect(isShareToken('a'.repeat(42))).toBe(false);
    expect(isShareToken(`${'a'.repeat(42)}+`)).toBe(false);
    expect(isShareToken(`${'a'.repeat(42)}/`)).toBe(false);
    expect(isShareToken(null)).toBe(false);
    expect(isShareToken(123)).toBe(false);
  });

  it('only shares a completed session', () => {
    expect(isShareableStatus('completed')).toBe(true);
    expect(isShareableStatus('active')).toBe(false);
    expect(isShareableStatus('abandoned')).toBe(false);
  });

  it('requires a real score', () => {
    expect(hasScorableResult(0, 0)).toBe(false);
    expect(hasScorableResult(5, 5)).toBe(true);
    expect(hasScorableResult(0, 10)).toBe(true);
    expect(hasScorableResult(11, 10)).toBe(false);
    expect(hasScorableResult(-1, 10)).toBe(false);
  });

  it('builds a payload containing only the allowed scalars', () => {
    const payload = buildSharePayload({
      kind: 'exam',
      direction: 'english-to-german',
      correctCount: 18,
      totalQuestions: 20,
      sharedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(payload.score).toBe(90);
    expect(Object.keys(payload).sort()).toEqual([
      'correctCount',
      'direction',
      'kind',
      'score',
      'sharedAt',
      'totalQuestions',
    ]);
    // Built field by field, so no owner-derived key can appear by accident.
    expect(JSON.stringify(payload)).not.toMatch(/user|owner|username/i);
  });

  it('never divides by zero', () => {
    expect(
      buildSharePayload({
        kind: 'practice',
        direction: 'random',
        correctCount: 0,
        totalQuestions: 0,
        sharedAt: '2026-01-01T00:00:00.000Z',
      }).score,
    ).toBe(0);
  });

  it('exposes the public path shape', () => {
    expect(sharePath('abc')).toBe('/share/abc');
  });
});
describe('share endpoints', () => {
  let database: SqliteDatabase;
  let server: ReturnType<typeof buildServer>;
  const now = new Date().toISOString();

  beforeEach(async () => {
    database = openDatabase(':memory:');
    server = buildServer(database, {
      secureCookies: false,
      authRateLimit: { max: 10_000, windowMs: 60_000 },
    });
    for (const id of ['owner', 'intruder']) {
      insertUser(database, {
        id,
        username: id,
        passwordHash: await hashPassword(PASSWORD),
        role: 'user',
        createdAt: now,
        updatedAt: now,
      });
      ensurePreferences(database, id, now);
    }
    commitVocabularyImport(
      database,
      'owner',
      [
        { english: 'hello', german: 'hallo', phonetics: undefined, alternatives: ['hallo'] },
        { english: 'tree', german: 'der Baum', phonetics: undefined, alternatives: ['der Baum'] },
      ],
      'seed',
      now,
    );
  });

  afterEach(async () => {
    await server.close();
    database.close();
  });

  async function signIn(username: string): Promise<string> {
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username, password: PASSWORD },
    });
    const raw = response.headers['set-cookie'];
    return String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
  }

  /** A completed session with `correct` right answers out of `total`. */
  function completedSession(userId: string, correct: number, total: number): string {
    const id = crypto.randomUUID();
    const session = startPracticeSession(
      database,
      { id, userId, direction: 'english-to-german', questionCount: total },
      now,
    );
    const entries = database.prepare('SELECT id FROM vocabulary_entries').all() as Array<{
      id: string;
    }>;
    const insert = database.prepare(
      `INSERT INTO learning_attempts
         (id, user_id, vocabulary_entry_id, direction, prompt, submitted_answer,
          normalized_answer, correct, score_delta, matching_reason, attempted_at, practice_session_id)
       VALUES (?, ?, ?, 'english-to-german', 'p', 'a', 'a', ?, 1, 'exact-match', ?, ?)`,
    );
    for (let i = 0; i < total; i += 1) {
      insert.run(
        `attempt-${userId}-${id}-${i}`,
        userId,
        entries[i % entries.length]!.id,
        i < correct ? 1 : 0,
        now,
        id,
      );
    }
    endPracticeSession(database, { ...session, answeredCount: total }, now);
    return id;
  }

  it('derives the score server-side and ignores a client-supplied one', async () => {
    const cookie = await signIn('owner');
    const sessionId = completedSession('owner', 1, 2);
    // A client trying to dictate its own numbers is refused, not trusted.
    const spoofed = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId, score: 100, correctCount: 99, totalQuestions: 99 },
    });
    expect(spoofed.statusCode).toBe(400);
    expect(spoofed.json().error.code).toBe('INVALID_SHARE_REQUEST');

    const ok = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId },
    });
    expect(ok.statusCode).toBe(201);
    const { share } = ok.json();
    expect(share.score).toBe(50);
    expect(share.correctCount).toBe(1);
    expect(share.totalQuestions).toBe(2);
    expect(share.token).toMatch(TOKEN_SHAPE);
    expect(share.path).toBe(`/share/${share.token}`);
  });

  it('refuses an unfinished session', async () => {
    const cookie = await signIn('owner');
    const id = crypto.randomUUID();
    startPracticeSession(
      database,
      { id, userId: 'owner', direction: 'english-to-german', questionCount: 5 },
      now,
    );
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId: id },
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe('NOT_SHAREABLE');
  });

  it("refuses another learner's session with the same generic error", async () => {
    const sessionId = completedSession('owner', 2, 2);
    const intruderCookie = await signIn('intruder');
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie: intruderCookie },
      payload: { sessionId },
    });
    expect(response.statusCode).toBe(404);
    // Identical to "not shareable", so ownership cannot be probed.
    expect(response.json().error.code).toBe('NOT_SHAREABLE');
  });

  it('serves a public card to an anonymous recipient with no owner identity', async () => {
    const cookie = await signIn('owner');
    const sessionId = completedSession('owner', 1, 2);
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId },
    });
    const { token } = created.json().share;

    // No cookie at all: this is the recipient's very first request.
    const response = await server.inject({ method: 'GET', url: `/api/v1/share/card/${token}` });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.result.score).toBe(50);
    expect(body.result.kind).toBe('practice');
    expect(Object.keys(body.result).sort()).toEqual([
      'correctCount',
      'direction',
      'kind',
      'score',
      'sharedAt',
      'totalQuestions',
    ]);
    const serialized = JSON.stringify(body);
    for (const leak of ['owner', 'intruder', 'username', 'userId', 'sessionId', 'hallo', 'Baum']) {
      expect(serialized).not.toContain(leak);
    }
  });

  it('answers unknown, malformed, and revoked tokens identically', async () => {
    const cookie = await signIn('owner');
    const sessionId = completedSession('owner', 1, 1);
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId },
    });
    const share = created.json().share;

    const unknown = await server.inject({
      method: 'GET',
      url: `/api/v1/share/card/${'z'.repeat(43)}`,
    });
    const malformed = await server.inject({ method: 'GET', url: '/api/v1/share/card/short' });
    const revoked = await server.inject({
      method: 'DELETE',
      url: `/api/v1/share/results/${share.id}`,
      headers: { cookie },
    });
    expect(revoked.statusCode).toBe(200);
    const afterRevoke = await server.inject({
      method: 'GET',
      url: `/api/v1/share/card/${share.token}`,
    });

    for (const response of [unknown, malformed, afterRevoke]) {
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe('SHARE_NOT_FOUND');
      expect(response.json().error.message).toBe('This shared result is not available.');
    }
  });

  it("does not let one learner revoke another learner's share", async () => {
    const ownerCookie = await signIn('owner');
    const sessionId = completedSession('owner', 1, 1);
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie: ownerCookie },
      payload: { sessionId },
    });
    const share = created.json().share;
    const intruderCookie = await signIn('intruder');
    const attempt = await server.inject({
      method: 'DELETE',
      url: `/api/v1/share/results/${share.id}`,
      headers: { cookie: intruderCookie },
    });
    expect(attempt.statusCode).toBe(404);
    const still = await server.inject({ method: 'GET', url: `/api/v1/share/card/${share.token}` });
    expect(still.statusCode).toBe(200);
  });

  it('returns a stable URL when the same result is shared twice', async () => {
    const cookie = await signIn('owner');
    const sessionId = completedSession('owner', 1, 1);
    const first = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId },
    });
    const second = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId },
    });
    expect(second.statusCode).toBe(201);
    expect(second.json().share.token).toBe(first.json().share.token);
  });

  it('lists only the owner’s own shares', async () => {
    const cookie = await signIn('owner');
    const sessionId = completedSession('owner', 1, 1);
    await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId },
    });
    const mine = await server.inject({
      method: 'GET',
      url: '/api/v1/share/results',
      headers: { cookie },
    });
    expect(mine.json().shares).toHaveLength(1);
    const intruderCookie = await signIn('intruder');
    const theirs = await server.inject({
      method: 'GET',
      url: '/api/v1/share/results',
      headers: { cookie: intruderCookie },
    });
    expect(theirs.json().shares).toHaveLength(0);
  });

  it('requires authentication to create a share', async () => {
    const sessionId = completedSession('owner', 1, 1);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      payload: { sessionId },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe('referral attribution', () => {
  let database: SqliteDatabase;
  let server: ReturnType<typeof buildServer>;
  const now = new Date().toISOString();

  beforeEach(async () => {
    database = openDatabase(':memory:');
    server = buildServer(database, {
      secureCookies: false,
      authRateLimit: { max: 10_000, windowMs: 60_000 },
    });
    insertUser(database, {
      id: 'sharer',
      username: 'sharer',
      passwordHash: await hashPassword(PASSWORD),
      role: 'user',
      createdAt: now,
      updatedAt: now,
    });
    ensurePreferences(database, 'sharer', now);
    commitVocabularyImport(
      database,
      'sharer',
      [{ english: 'hello', german: 'hallo', phonetics: undefined, alternatives: ['hallo'] }],
      'seed',
      now,
    );
  });

  afterEach(async () => {
    await server.close();
    database.close();
  });

  /** A sharer's completed, shared result, and its public token. */
  async function makeShare(): Promise<string> {
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'sharer', password: PASSWORD },
    });
    const raw = login.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
    const id = crypto.randomUUID();
    const session = startPracticeSession(
      database,
      { id, userId: 'sharer', direction: 'english-to-german', questionCount: 1 },
      now,
    );
    const entry = database.prepare('SELECT id FROM vocabulary_entries').get() as { id: string };
    database
      .prepare(
        `INSERT INTO learning_attempts
           (id, user_id, vocabulary_entry_id, direction, prompt, submitted_answer,
            normalized_answer, correct, score_delta, matching_reason, attempted_at, practice_session_id)
         VALUES ('a1', 'sharer', ?, 'english-to-german', 'hello', 'hallo', 'hallo', 1, 1,
                 'exact-match', ?, ?)`,
      )
      .run(entry.id, now, id);
    endPracticeSession(database, { ...session, answeredCount: 1 }, now);
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/share/results',
      headers: { cookie },
      payload: { sessionId: id },
    });
    return created.json().share.token as string;
  }

  /** Open the public card as an anonymous recipient and return its referral cookie. */
  async function openAsRecipient(token: string): Promise<string> {
    const viewed = await server.inject({ method: 'GET', url: `/api/v1/share/card/${token}` });
    expect(viewed.statusCode).toBe(200);
    return String(viewed.headers['set-cookie']).split(';')[0]!;
  }

  function attributionCount(): number {
    const row = database.prepare('SELECT COUNT(*) AS c FROM referral_attributions').get() as {
      c: number;
    };
    return Number(row.c);
  }

  it('attributes a registration that follows a shared card', async () => {
    const token = await makeShare();
    const referral = await openAsRecipient(token);
    expect(referral).toContain('taptalk_referral=');

    const registered = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { cookie: referral },
      payload: { username: 'friend', password: 'Another-Good-7' },
    });
    expect(registered.statusCode).toBe(201);
    // Consumed once, so a later unrelated sign-in is not silently re-attributed.
    const cookies = registered.headers['set-cookie'] as string[];
    expect(cookies.some((c) => c.includes('taptalk_referral=;') && c.includes('Max-Age=0'))).toBe(
      true,
    );

    const row = database
      .prepare(
        `SELECT u.username AS username, s.user_id AS owner
         FROM referral_attributions r
         JOIN users u ON u.id = r.referred_user_id
         JOIN shared_results s ON s.id = r.shared_result_id`,
      )
      .get();
    expect(row).toEqual({ username: 'friend', owner: 'sharer' });
  });

  it('counts a re-arriving learner once, not twice', async () => {
    const token = await makeShare();
    const first = await openAsRecipient(token);
    await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { cookie: first },
      payload: { username: 'friend', password: 'Another-Good-7' },
    });
    // A second, unrelated browser also arriving through the same share.
    const second = await openAsRecipient(token);
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { cookie: second },
      payload: { username: 'friend', password: 'Another-Good-7' },
    });
    expect(login.statusCode).toBe(200);
    expect(attributionCount()).toBe(1);
  });

  it('converts the attribution on the referred learner first answer, once', async () => {
    const token = await makeShare();
    const referral = await openAsRecipient(token);
    await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { cookie: referral },
      payload: { username: 'friend', password: 'Another-Good-7' },
    });
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'friend', password: 'Another-Good-7' },
    });
    const raw = login.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
    const entry = database.prepare('SELECT id FROM vocabulary_entries').get() as { id: string };
    const answer = () =>
      server.inject({
        method: 'POST',
        url: '/api/v1/practice/answer',
        headers: { cookie },
        payload: {
          vocabularyEntryId: entry.id,
          direction: 'english-to-german',
          submittedAnswer: 'hallo',
        },
      });
    const converted = () =>
      Number(
        (
          database
            .prepare(
              'SELECT COUNT(*) AS c FROM referral_attributions WHERE converted_at IS NOT NULL',
            )
            .get() as { c: number }
        ).c,
      );
    expect((await answer()).statusCode).toBe(200);
    expect(converted()).toBe(1);
    await answer();
    await answer();
    expect(converted()).toBe(1);
  });

  it('refuses a self-referral', async () => {
    const token = await makeShare();
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { cookie: `taptalk_referral=${token}` },
      payload: { username: 'sharer', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(attributionCount()).toBe(0);
  });

  it('ignores a tampered or malformed referral cookie', async () => {
    const values = ['not-a-real-token', '../../etc/passwd', `${'z'.repeat(43)}`, '%3Bdrop'];
    for (const [index, value] of values.entries()) {
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { cookie: `taptalk_referral=${value}` },
        payload: { username: `stranger${index}`, password: 'Another-Good-7' },
      });
      expect(response.statusCode).toBe(201);
    }
    expect(attributionCount()).toBe(0);
  });

  it('never attributes a referral to a revoked share', async () => {
    const token = await makeShare();
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'sharer', password: PASSWORD },
    });
    const raw = login.headers['set-cookie'];
    const cookie = String(Array.isArray(raw) ? raw[0] : raw).split(';')[0]!;
    const share = database.prepare('SELECT id FROM shared_results').get() as { id: string };
    const revoked = await server.inject({
      method: 'DELETE',
      url: `/api/v1/share/results/${share.id}`,
      headers: { cookie },
    });
    expect(revoked.statusCode).toBe(200);
    await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { cookie: `taptalk_referral=${token}` },
      payload: { username: 'friend', password: 'Another-Good-7' },
    });
    expect(attributionCount()).toBe(0);
  });
});
