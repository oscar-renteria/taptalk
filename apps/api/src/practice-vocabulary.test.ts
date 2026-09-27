import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { openDatabase, type SqliteDatabase } from './database.js';
import { resetGuestStore } from './guest-store.js';

const now = '2026-01-01T00:00:00.000Z';

/** Two entries with distinct ids, so selection by id is distinguishable. */
function seed(database: SqliteDatabase): void {
  for (const [id, english, german] of [
    ['entry-apple', 'apple', 'Apfel'],
    ['entry-house', 'house', 'Haus'],
    ['entry-car', 'car', 'Auto'],
  ] as const) {
    database
      .prepare(
        'INSERT INTO vocabulary_entries (id, english, phonetics, german_display, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)',
      )
      .run(id, english, german, now, now);
    database
      .prepare(
        'INSERT INTO vocabulary_answers (id, vocabulary_entry_id, answer, normalized_answer) VALUES (?, ?, ?, ?)',
      )
      .run(`answer-${id}`, id, german, german.toLowerCase());
  }
}

async function setup() {
  const database = openDatabase();
  seed(database);
  const server = buildServer(database, { secureCookies: false });
  const registration = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username: 'learner', password: 'a-secure-password' },
  });
  const cookie = String(registration.headers['set-cookie']).split(';')[0]!;
  return { database, server, cookie };
}

async function guestSetup() {
  const database = openDatabase();
  seed(database);
  const server = buildServer(database, { secureCookies: false });
  const started = await server.inject({ method: 'POST', url: '/api/v1/auth/guest' });
  const cookie = String(started.headers['set-cookie']).split(';')[0]!;
  return { database, server, cookie };
}

const listFor = async (server: ReturnType<typeof buildServer>, cookie: string) =>
  (await (
    await server.inject({ method: 'GET', url: '/api/v1/practice/vocabulary', headers: { cookie } })
  ).json()) as {
    entries: Array<{ id: string; english: string; german: string; enabled: boolean }>;
  };

describe('practice vocabulary selection', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('lists every entry as enabled to a new user', async () => {
    const { server, cookie } = await setup();
    const { entries } = await listFor(server, cookie);
    expect(entries.map((e) => e.english)).toEqual(['apple', 'car', 'house']);
    expect(entries.every((e) => e.enabled)).toBe(true);
    await server.close();
  });

  it('persists a selection across requests for a registered user', async () => {
    const { server, cookie } = await setup();
    const saved = await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: ['entry-car'] },
    });
    expect(saved.statusCode).toBe(200);
    const { entries } = await listFor(server, cookie);
    expect(entries.find((e) => e.id === 'entry-car')?.enabled).toBe(false);
    expect(entries.find((e) => e.id === 'entry-apple')?.enabled).toBe(true);
    // A fresh read, as after a reload, sees the same thing.
    expect((await listFor(server, cookie)).entries.filter((e) => !e.enabled)).toHaveLength(1);
    await server.close();
  });

  it('replaces the whole set, so re-enabling clears the row', async () => {
    const { server, cookie, database } = await setup();
    await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: ['entry-car', 'entry-house'] },
    });
    await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: [] },
    });
    const stored = database
      .prepare('SELECT COUNT(*) AS total FROM user_practice_vocabulary_exclusions')
      .get() as { total: number };
    expect(Number(stored.total)).toBe(0);
    expect((await listFor(server, cookie)).entries.every((e) => e.enabled)).toBe(true);
    await server.close();
  });

  it('rejects unknown vocabulary ids instead of storing them', async () => {
    const { server, cookie, database } = await setup();
    const response = await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: ['entry-car', 'does-not-exist'] },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: 'UNKNOWN_VOCABULARY_ENTRY' } });
    // Nothing was written, so the good id was not silently applied either.
    const stored = database
      .prepare('SELECT COUNT(*) AS total FROM user_practice_vocabulary_exclusions')
      .get() as { total: number };
    expect(Number(stored.total)).toBe(0);
    await server.close();
  });

  it('rejects a malformed selection', async () => {
    const { server, cookie } = await setup();
    for (const body of [{ disabledIds: 'nope' }, {}, { disabledIds: [7] }]) {
      const response = await server.inject({
        method: 'PUT',
        url: '/api/v1/practice/vocabulary',
        headers: { cookie },
        payload: body as object,
      });
      expect(response.statusCode).toBe(400);
    }
    await server.close();
  });

  it('keeps one user selection out of another user', async () => {
    const { server, cookie } = await setup();
    await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: ['entry-car'] },
    });
    const other = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { username: 'someone-else', password: 'a-secure-password' },
    });
    const otherCookie = String(other.headers['set-cookie']).split(';')[0]!;
    // The second user is unaffected and cannot see the first user's rows.
    expect((await listFor(server, otherCookie)).entries.every((e) => e.enabled)).toBe(true);
    await server.close();
  });

  it('cleans up when a vocabulary entry is deleted', async () => {
    const { server, cookie, database } = await setup();
    await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: ['entry-car'] },
    });
    // Deleting the entry cascades the selection row away, so no stale id remains.
    database.prepare('DELETE FROM vocabulary_entries WHERE id = ?').run('entry-car');
    const stale = database
      .prepare(
        'SELECT COUNT(*) AS total FROM user_practice_vocabulary_exclusions WHERE vocabulary_entry_id = ?',
      )
      .get('entry-car') as { total: number };
    expect(Number(stale.total)).toBe(0);
    const { entries } = await listFor(server, cookie);
    expect(entries.find((e) => e.id === 'entry-car')).toBeUndefined();
    await server.close();
  });

  it('is enabled for a newly added entry without any action', async () => {
    const { server, cookie, database } = await setup();
    await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: ['entry-car'] },
    });
    database
      .prepare(
        'INSERT INTO vocabulary_entries (id, english, phonetics, german_display, created_at, updated_at) VALUES (?, ?, NULL, ?, ?, ?)',
      )
      .run('entry-new', 'newcomer', 'Neuzugang', now, now);
    const { entries } = await listFor(server, cookie);
    // Documented default: a new entry is immediately available for practice.
    expect(entries.find((e) => e.id === 'entry-new')?.enabled).toBe(true);
    await server.close();
  });
});

describe('practice respects the selection', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  /** Asks for a question repeatedly and collects which entries came up. */
  async function entriesSeen(server: ReturnType<typeof buildServer>, cookie: string) {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i += 1) {
      const response = await server.inject({
        method: 'GET',
        url: '/api/v1/practice/question?direction=english-to-german',
        headers: { cookie },
      });
      if (response.statusCode !== 200) break;
      const { question } = (await response.json()) as { question: { vocabularyEntryId: string } };
      seen.add(question.vocabularyEntryId);
    }
    return seen;
  }

  it('never asks a disabled entry, for a user or a guest', async () => {
    const user = await setup();
    const guest = await guestSetup();
    for (const ctx of [user, guest]) {
      await ctx.server.inject({
        method: 'PUT',
        url: '/api/v1/practice/vocabulary',
        headers: { cookie: ctx.cookie },
        payload: { disabledIds: ['entry-car', 'entry-house'] },
      });
    }
    for (const ctx of [user, guest]) {
      const seen = await entriesSeen(ctx.server, ctx.cookie);
      expect(seen.has('entry-car'), 'car must not be asked').toBe(false);
      expect(seen.has('entry-house'), 'house must not be asked').toBe(false);
      expect(seen.has('entry-apple'), 'the enabled entry is asked').toBe(true);
    }
    await user.server.close();
    await guest.server.close();
  });

  it('refuses to start a session when everything is disabled', async () => {
    const { server, cookie } = await setup();
    const { entries } = await listFor(server, cookie);
    await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: entries.map((e) => e.id) },
    });
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/practice/sessions',
      headers: { cookie },
      payload: {},
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: { code: 'NO_PRACTICE_VOCABULARY' } });
    // The question endpoint says the same, rather than returning a broken card.
    const question = await server.inject({
      method: 'GET',
      url: '/api/v1/practice/question',
      headers: { cookie },
    });
    expect(question.statusCode).toBe(404);
    await server.close();
  });

  it('keeps a guest selection out of the database', async () => {
    const { server, cookie, database } = await guestSetup();
    const { entries } = await listFor(server, cookie);
    await server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie },
      payload: { disabledIds: [entries[0]!.id] },
    });
    const stored = database
      .prepare('SELECT COUNT(*) AS total FROM user_practice_vocabulary_exclusions')
      .get() as { total: number };
    expect(Number(stored.total)).toBe(0);
    // It still works for the guest that set it.
    expect((await listFor(server, cookie)).entries.filter((e) => !e.enabled)).toHaveLength(1);
    await server.close();
  });

  it('keeps two guests selections separate', async () => {
    const a = await guestSetup();
    const b = await guestSetup();
    await a.server.inject({
      method: 'PUT',
      url: '/api/v1/practice/vocabulary',
      headers: { cookie: a.cookie },
      payload: { disabledIds: ['entry-car'] },
    });
    expect((await listFor(a.server, a.cookie)).entries.filter((e) => !e.enabled)).toHaveLength(1);
    expect((await listFor(b.server, b.cookie)).entries.every((e) => e.enabled)).toBe(true);
    await a.server.close();
    await b.server.close();
  });

  it('requires an identity', async () => {
    const { server } = await setup();
    expect(
      (await server.inject({ method: 'GET', url: '/api/v1/practice/vocabulary' })).statusCode,
    ).toBe(401);
    expect(
      (
        await server.inject({
          method: 'PUT',
          url: '/api/v1/practice/vocabulary',
          payload: { disabledIds: [] },
        })
      ).statusCode,
    ).toBe(401);
    await server.close();
  });
});
