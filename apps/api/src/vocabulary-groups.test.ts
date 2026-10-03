import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { openDatabase, type SqliteDatabase } from './database.js';
import { resetGuestStore } from './guest-store.js';
import {
  getSelectionCandidates,
  getSessionVocabularyScope,
  listVocabularyGroups,
} from './repositories.js';

const now = '2026-01-01T00:00:00.000Z';

const WORDS = [
  ['entry-apple', 'apple', 'Apfel'],
  ['entry-house', 'house', 'Haus'],
  ['entry-car', 'car', 'Auto'],
  ['entry-garden', 'garden', 'Garten'],
] as const;

/** Four entries, each with an answer, so all four are eligible for selection. */
function seed(database: SqliteDatabase): void {
  for (const [id, english, german] of WORDS) {
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

async function registerAs(server: ReturnType<typeof buildServer>, username: string) {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { username, password: 'a-secure-password' },
  });
  return String(response.headers['set-cookie']).split(';')[0]!;
}

async function setup() {
  const database = openDatabase();
  seed(database);
  const server = buildServer(database, { secureCookies: false });
  return { database, server, cookie: await registerAs(server, 'learner') };
}

/** The caller's user id, for the repository-level assertions. */
function userIdOf(database: SqliteDatabase, username = 'learner'): string {
  return (
    database.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string }
  ).id;
}

const createGroup = (server: ReturnType<typeof buildServer>, cookie: string, name: string) =>
  server.inject({ method: 'POST', url: '/api/v1/groups', headers: { cookie }, payload: { name } });

const setEntries = (
  server: ReturnType<typeof buildServer>,
  cookie: string,
  groupId: string,
  vocabularyEntryIds: string[],
) =>
  server.inject({
    method: 'PUT',
    url: `/api/v1/groups/${groupId}/entries`,
    headers: { cookie },
    payload: { vocabularyEntryIds },
  });

/**
 * Sessions are 10 questions by default, which is more than this fixture's groups
 * hold. Shortening the session is the intended answer to "my group is small", so
 * that is what these tests do rather than seeding a much larger vocabulary.
 */
const setSessionLength = (
  server: ReturnType<typeof buildServer>,
  cookie: string,
  sessionLength: number,
) =>
  server.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    headers: { cookie },
    payload: { sessionLength, direction: 'english-to-german', repetitionPreference: 'balanced' },
  });

describe('vocabulary groups', () => {
  beforeEach(() => resetGuestStore());

  describe('creating and renaming', () => {
    it('creates an empty group owned by the caller', async () => {
      const { server, cookie, database } = await setup();
      const created = await createGroup(server, cookie, '  Unit 3  ');
      expect(created.statusCode).toBe(201);
      // Whitespace is trimmed by the schema rather than stored verbatim.
      expect(created.json().group.name).toBe('Unit 3');
      expect(created.json().group.selectedCount).toBe(0);
      expect(listVocabularyGroups(database, userIdOf(database))).toHaveLength(1);
    });

    it('rejects a name that is only whitespace', async () => {
      const { server, cookie } = await setup();
      const created = await createGroup(server, cookie, '    ');
      expect(created.statusCode).toBe(400);
      expect(created.json().error.code).toBe('INVALID_GROUP_NAME');
    });

    it('allows two groups with the same name', async () => {
      const { server, cookie } = await setup();
      expect((await createGroup(server, cookie, 'Review')).statusCode).toBe(201);
      expect((await createGroup(server, cookie, 'Review')).statusCode).toBe(201);
      const list = await server.inject({
        method: 'GET',
        url: '/api/v1/groups',
        headers: { cookie },
      });
      expect(list.json().groups).toHaveLength(2);
    });

    it('never takes the owner from the request body', async () => {
      const { server, cookie, database } = await setup();
      const response = await server.inject({
        method: 'POST',
        url: '/api/v1/groups',
        headers: { cookie },
        payload: { name: 'Mine', userId: 'somebody-else' },
      });
      // Strict, so the extra key is refused outright rather than silently ignored.
      expect(response.statusCode).toBe(400);
      // Refused means nothing was written, not that the owner was quietly replaced.
      expect(listVocabularyGroups(database, userIdOf(database))).toEqual([]);
    });

    it('renames a group and leaves the vocabulary alone', async () => {
      const { server, cookie, database } = await setup();
      const groupId = (await createGroup(server, cookie, 'Old')).json().group.id;
      const renamed = await server.inject({
        method: 'PATCH',
        url: `/api/v1/groups/${groupId}`,
        headers: { cookie },
        payload: { name: 'New' },
      });
      expect(renamed.json().group.name).toBe('New');
      expect(database.prepare('SELECT COUNT(*) AS n FROM vocabulary_entries').get()).toEqual({
        n: 4,
      });
    });
  });

  describe('membership', () => {
    it('stores references and refuses an unknown vocabulary id', async () => {
      const { server, cookie } = await setup();
      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      const saved = await setEntries(server, cookie, groupId, ['entry-apple', 'entry-car']);
      expect(saved.statusCode).toBe(200);
      expect(saved.json().entryIds.sort()).toEqual(['entry-apple', 'entry-car']);

      const bogus = await setEntries(server, cookie, groupId, ['entry-house', 'does-not-exist']);
      expect(bogus.statusCode).toBe(404);
    });

    it('is replaceable, so clearing a group really empties it', async () => {
      const { server, cookie } = await setup();
      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      await setEntries(server, cookie, groupId, ['entry-apple', 'entry-house']);
      expect((await setEntries(server, cookie, groupId, [])).json().entryIds).toEqual([]);
      expect((await setEntries(server, cookie, groupId, ['entry-car'])).json().entryIds).toEqual([
        'entry-car',
      ]);
    });

    it('lets one entry sit in several groups', async () => {
      const { server, cookie } = await setup();
      const a = (await createGroup(server, cookie, 'A')).json().group.id;
      const b = (await createGroup(server, cookie, 'B')).json().group.id;
      await setEntries(server, cookie, a, ['entry-apple']);
      await setEntries(server, cookie, b, ['entry-apple']);
      const detail = await server.inject({
        method: 'GET',
        url: `/api/v1/groups/${a}`,
        headers: { cookie },
      });
      expect(detail.json().group.selectedCount).toBe(1);
    });

    it('returns every entry with its membership flag in one request', async () => {
      const { server, cookie } = await setup();
      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      await setEntries(server, cookie, groupId, ['entry-car']);
      const detail = await server.inject({
        method: 'GET',
        url: `/api/v1/groups/${groupId}`,
        headers: { cookie },
      });
      const entries = detail.json().entries as Array<{
        vocabularyEntryId: string;
        selected: boolean;
      }>;
      expect(
        entries.filter((entry) => entry.selected).map((entry) => entry.vocabularyEntryId),
      ).toEqual(['entry-car']);
      expect(entries).toHaveLength(4);
    });
  });

  describe('ownership', () => {
    it("hides another learner's group behind the same 404 as a missing one", async () => {
      const { server, cookie, database } = await setup();
      const otherCookie = await registerAs(server, 'intruder');
      const groupId = (await createGroup(server, cookie, 'Private')).json().group.id;

      const foreignRead = await server.inject({
        method: 'GET',
        url: `/api/v1/groups/${groupId}`,
        headers: { cookie: otherCookie },
      });
      const missingRead = await server.inject({
        method: 'GET',
        url: '/api/v1/groups/no-such-group',
        headers: { cookie: otherCookie },
      });
      expect(foreignRead.statusCode).toBe(missingRead.statusCode);
      expect(foreignRead.statusCode).toBe(404);

      // And the listing never leaks it.
      const list = await server.inject({
        method: 'GET',
        url: '/api/v1/groups',
        headers: { cookie: otherCookie },
      });
      expect(list.json().groups).toEqual([]);

      const foreignDelete = await server.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${groupId}`,
        headers: { cookie: otherCookie },
      });
      expect(foreignDelete.statusCode).toBe(404);
      expect(
        database.prepare('SELECT name FROM vocabulary_groups WHERE id = ?').get(groupId),
      ).toEqual({ name: 'Private' });
    });

    it('requires a signed-in learner', async () => {
      const { server } = await setup();
      expect((await createGroup(server, '', 'Nope')).statusCode).toBe(401);
    });

    it('refuses to start a guest session scoped to a group', async () => {
      const { server, cookie } = await setup();
      const guest = await server.inject({ method: 'POST', url: '/api/v1/auth/guest' });
      const guestCookie = String(guest.headers['set-cookie']).split(';')[0]!;
      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      const started = await server.inject({
        method: 'POST',
        url: '/api/v1/practice/sessions',
        headers: { cookie: guestCookie },
        payload: { groupId },
      });
      expect(started.statusCode).toBe(403);
      expect(started.json().error.code).toBe('GROUP_REQUIRES_ACCOUNT');
    });

    it('refuses to overwrite the membership of a group it does not own', async () => {
      const { server, cookie } = await setup();
      const otherCookie = await registerAs(server, 'intruder');
      const groupId = (await createGroup(server, cookie, 'Private')).json().group.id;
      expect((await setEntries(server, otherCookie, groupId, ['entry-apple'])).statusCode).toBe(
        404,
      );
    });
  });

  describe('selection', () => {
    it('narrows candidates to the group', async () => {
      const { server, cookie, database } = await setup();
      const userId = userIdOf(database);
      expect(getSelectionCandidates(database, userId, null)).toHaveLength(4);

      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      await setEntries(server, cookie, groupId, ['entry-apple', 'entry-car']);
      const scoped = getSelectionCandidates(database, userId, null, groupId);
      expect(scoped.map((candidate) => candidate.id).sort()).toEqual(['entry-apple', 'entry-car']);
    });

    it('fails closed for an unknown or foreign group id', async () => {
      const { server, cookie, database } = await setup();
      const groupId = (await createGroup(server, cookie, 'Private')).json().group.id;
      const userId = userIdOf(database);
      // Ownership lives in the query, so a foreign or bogus id matches no entries
      // and yields an empty pool rather than the learner's whole vocabulary. The
      // route turns that into a 404 before a session is ever created.
      expect(getSelectionCandidates(database, userId, null, groupId)).toEqual([]);
      expect(getSelectionCandidates(database, userId, null, 'nonsense')).toEqual([]);
      const started = await server.inject({
        method: 'POST',
        url: '/api/v1/practice/sessions',
        headers: { cookie },
        payload: { groupId: 'nonsense' },
      });
      expect(started.statusCode).toBe(404);
      expect(started.json().error.code).toBe('GROUP_NOT_FOUND');
    });

    it('still honours the existing per-user on/off selection inside a group', async () => {
      const { server, cookie, database } = await setup();
      const userId = userIdOf(database);
      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      await setEntries(server, cookie, groupId, ['entry-apple', 'entry-car']);
      // Switch one of the grouped words off in Settings, as before this feature.
      await server.inject({
        method: 'PUT',
        url: '/api/v1/practice/vocabulary',
        headers: { cookie },
        payload: { disabledIds: ['entry-car'] },
      });
      const scoped = getSelectionCandidates(database, userId, null, groupId);
      expect(scoped.map((candidate) => candidate.id)).toEqual(['entry-apple']);
    });

    it('practises only the grouped words', async () => {
      const { server, cookie } = await setup();
      await setSessionLength(server, cookie, 2);
      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      await setEntries(server, cookie, groupId, ['entry-apple', 'entry-car']);
      const session = await server.inject({
        method: 'POST',
        url: '/api/v1/practice/sessions',
        headers: { cookie },
        payload: { groupId },
      });
      expect(session.statusCode).toBe(201);
      const sessionId = session.json().session.id;
      for (let index = 0; index < 4; index += 1) {
        const question = await server.inject({
          method: 'GET',
          url: `/api/v1/practice/question?practiceSessionId=${sessionId}`,
          headers: { cookie },
        });
        expect(question.json().question.vocabularyEntryId).toMatch(/entry-(apple|car)/);
      }
    });

    it('keeps the scope on the session, so later edits cannot widen a running one', async () => {
      const { server, cookie, database } = await setup();
      const userId = userIdOf(database);
      await setSessionLength(server, cookie, 2);
      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      await setEntries(server, cookie, groupId, ['entry-apple', 'entry-car']);
      const session = (
        await server.inject({
          method: 'POST',
          url: '/api/v1/practice/sessions',
          headers: { cookie },
          payload: { groupId },
        })
      ).json().session;

      expect(getSessionVocabularyScope(database, userId, session.id)).toEqual({
        groupId,
        groupName: 'Food',
      });

      // Widening the group mid-session must not widen the running session.
      await setEntries(server, cookie, groupId, ['entry-apple', 'entry-car', 'entry-house']);
      for (let index = 0; index < 4; index += 1) {
        const question = await server.inject({
          method: 'GET',
          url: `/api/v1/practice/question?practiceSessionId=${session.id}`,
          headers: { cookie },
        });
        expect(question.json().question.vocabularyEntryId).not.toBe('entry-house');
      }
    });
  });

  describe('insufficient vocabulary', () => {
    it('refuses an empty group instead of widening to everything', async () => {
      const { server, cookie } = await setup();
      const groupId = (await createGroup(server, cookie, 'Empty')).json().group.id;
      const started = await server.inject({
        method: 'POST',
        url: '/api/v1/practice/sessions',
        headers: { cookie },
        payload: { groupId },
      });
      expect(started.statusCode).toBe(422);
      expect(started.json().error.code).toBe('GROUP_EMPTY');
    });

    it('refuses a group too small for the requested exam length', async () => {
      const { server, cookie } = await setup();
      const groupId = (await createGroup(server, cookie, 'Tiny')).json().group.id;
      await setEntries(server, cookie, groupId, ['entry-apple', 'entry-car']);
      const exam = await server.inject({
        method: 'POST',
        url: '/api/v1/exams',
        headers: { cookie },
        payload: { groupId, questionCount: 20 },
      });
      expect(exam.statusCode).toBe(422);
      expect(exam.json().error.code).toBe('GROUP_TOO_SMALL');
    });

    it('leaves an unscoped session working when there are no groups at all', async () => {
      const { server, cookie } = await setup();
      const started = await server.inject({
        method: 'POST',
        url: '/api/v1/practice/sessions',
        headers: { cookie },
        payload: {},
      });
      expect(started.statusCode).toBe(201);
    });
  });

  describe('deletion', () => {
    it('removes the group but no vocabulary, and keeps the session label', async () => {
      const { server, cookie, database } = await setup();
      const userId = userIdOf(database);
      await setSessionLength(server, cookie, 2);
      const groupId = (await createGroup(server, cookie, 'Food')).json().group.id;
      await setEntries(server, cookie, groupId, ['entry-apple', 'entry-car']);
      const session = (
        await server.inject({
          method: 'POST',
          url: '/api/v1/practice/sessions',
          headers: { cookie },
          payload: { groupId },
        })
      ).json().session;

      const deleted = await server.inject({
        method: 'DELETE',
        url: `/api/v1/groups/${groupId}`,
        headers: { cookie },
      });
      expect(deleted.statusCode).toBe(200);

      // The words survive and are selectable again.
      expect(database.prepare('SELECT COUNT(*) AS n FROM vocabulary_entries').get()).toEqual({
        n: 4,
      });
      expect(getSelectionCandidates(database, userId, null)).toHaveLength(4);
      // Membership went with the group.
      expect(database.prepare('SELECT COUNT(*) AS n FROM vocabulary_group_entries').get()).toEqual({
        n: 0,
      });
      // The historical session keeps the name it was created under, and a deleted
      // scope falls back to all vocabulary instead of breaking the session.
      expect(getSessionVocabularyScope(database, userId, session.id)).toEqual({
        groupId: null,
        groupName: 'Food',
      });
      const question = await server.inject({
        method: 'GET',
        url: `/api/v1/practice/question?practiceSessionId=${session.id}`,
        headers: { cookie },
      });
      expect(question.statusCode).toBe(200);
    });
  });
});
