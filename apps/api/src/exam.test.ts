import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { openDatabase, type SqliteDatabase } from './database.js';
import { resetGuestStore } from './guest-store.js';
import { examScore, getExamStatistics } from './repositories.js';

const now = '2026-01-01T00:00:00.000Z';

/** The fixture vocabulary, so a test can answer whatever it is actually asked. */
const germanById = new Map([
  ['entry-apple', 'Apfel'],
  ['entry-house', 'Haus'],
  ['entry-car', 'Auto'],
]);

/** Three entries so an exam can ask more than one question. */
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
  // A two-question exam keeps the tests quick.
  await server.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    headers: { cookie },
    payload: { direction: 'english-to-german', sessionLength: 2, repetitionPreference: 'balanced' },
  });
  return { database, server, cookie };
}

async function guestSetup() {
  const database = openDatabase();
  seed(database);
  const server = buildServer(database, { secureCookies: false });
  const started = await server.inject({ method: 'POST', url: '/api/v1/auth/guest' });
  const cookie = String(started.headers['set-cookie']).split(';')[0]!;
  await server.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    headers: { cookie },
    payload: { direction: 'english-to-german', sessionLength: 2, repetitionPreference: 'balanced' },
  });
  return { database, server, cookie };
}

/**
 * The German answer for a vocabulary id. Which entry an exam asks is weighted and
 * not predictable, so tests read the answer rather than assuming one.
 */
function germanFor(vocabularyEntryId: string): string {
  const row = germanById.get(vocabularyEntryId);
  if (!row) throw new Error(`Unknown fixture entry ${vocabularyEntryId}`);
  return row;
}

const startExam = async (server: ReturnType<typeof buildServer>, cookie: string) => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/exams',
    headers: { cookie },
    payload: {},
  });
  return {
    status: response.statusCode,
    id: (response.json() as { session?: { id: string } }).session?.id,
  };
};

const nextQuestion = async (
  server: ReturnType<typeof buildServer>,
  cookie: string,
  examId: string,
) => {
  const response = await server.inject({
    method: 'GET',
    url: `/api/v1/practice/question?practiceSessionId=${examId}`,
    headers: { cookie },
  });
  return (response.json() as { question?: { vocabularyEntryId: string } }).question;
};

describe('exam scoring is deterministic', () => {
  it('is a whole percentage and handles the empty case', () => {
    expect(examScore(1, 2)).toBe(50);
    expect(examScore(5, 5)).toBe(100);
    expect(examScore(0, 3)).toBe(0);
    // 2/3 rounds to 67, not 66.6, so the same exam always shows the same score.
    expect(examScore(2, 3)).toBe(67);
    expect(examScore(0, 0)).toBe(0);
  });
});

describe('an active exam reveals nothing but correctness', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('returns only correct/incorrect, with no answer anywhere in the payload', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    const question = await nextQuestion(server, cookie, id!);

    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/answer`,
      headers: { cookie },
      payload: {
        vocabularyEntryId: question!.vocabularyEntryId,
        direction: 'english-to-german',
        submittedAnswer: germanFor(question!.vocabularyEntryId),
      },
    });
    const body = JSON.stringify(response.json());
    expect(response.statusCode).toBe(200);
    // The whole response body is the assertion: no answer, no reason, no score.
    expect(body).not.toMatch(/Apfel|correctAnswer|matchingReason|scoreDelta|Haus|Auto/);
    expect(response.json()).toEqual({
      result: { correct: true },
      session: { id, answeredCount: 1, questionCount: 2 },
    });
    await server.close();
  });

  it('does not reveal the answer after an incorrect answer either', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    const question = await nextQuestion(server, cookie, id!);
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/answer`,
      headers: { cookie },
      payload: {
        vocabularyEntryId: question!.vocabularyEntryId,
        direction: 'english-to-german',
        submittedAnswer: 'nonsense',
      },
    });
    const body = JSON.stringify(response.json());
    expect(body).not.toMatch(/correctAnswer|matchingReason|nonsense/);
    expect(response.json()).toMatchObject({ result: { correct: false } });
    await server.close();
  });

  it('refuses the result endpoint while the exam is still running', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/exams/${id}`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(JSON.stringify(response.json())).not.toMatch(/correctAnswer/);
    await server.close();
  });

  it('refuses submissions once the exam is full, so a score cannot be inflated', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    // Fill the two-question exam.
    let last: { vocabularyEntryId: string } | undefined;
    for (let i = 0; i < 2; i += 1) {
      const question = await nextQuestion(server, cookie, id!);
      last = question;
      const response = await server.inject({
        method: 'POST',
        url: `/api/v1/exams/${id}/answer`,
        headers: { cookie },
        payload: {
          vocabularyEntryId: question!.vocabularyEntryId,
          direction: 'english-to-german',
          submittedAnswer: germanFor(question!.vocabularyEntryId),
        },
      });
      expect(response.statusCode).toBe(200);
    }
    // A third submission cannot add to the score.
    const extra = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/answer`,
      headers: { cookie },
      payload: {
        vocabularyEntryId: last!.vocabularyEntryId,
        direction: 'english-to-german',
        submittedAnswer: germanFor(last!.vocabularyEntryId),
      },
    });
    expect(extra.statusCode).toBe(409);
    await server.close();
  });
});

describe('exam completion and results', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  async function playWholeExam(ctx: Awaited<ReturnType<typeof setup>>, correct: boolean) {
    const { server, cookie } = ctx;
    const { id } = await startExam(server, cookie);
    for (let i = 0; i < 2; i += 1) {
      const question = await nextQuestion(server, cookie, id!);
      const entry = germanFor(question!.vocabularyEntryId);
      await server.inject({
        method: 'POST',
        url: `/api/v1/exams/${id}/answer`,
        headers: { cookie },
        payload: {
          vocabularyEntryId: question!.vocabularyEntryId,
          direction: 'english-to-german',
          submittedAnswer: correct ? entry : 'wrong',
        },
      });
    }
    const ended = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/end`,
      headers: { cookie },
    });
    return { id: id!, body: ended.json() as { result: Record<string, unknown> } };
  }

  it('reveals the full result only after the exam ends', async () => {
    const ctx = await setup();
    const { body } = await playWholeExam(ctx, true);
    const result = body.result as {
      totalQuestions: number;
      correctCount: number;
      incorrectCount: number;
      score: number;
      status: string;
      questions: Array<{ correctAnswer: string; submittedAnswer: string; correct: boolean }>;
    };
    expect(result.totalQuestions).toBe(2);
    expect(result.correctCount).toBe(2);
    expect(result.incorrectCount).toBe(0);
    expect(result.score).toBe(100);
    expect(result.status).toBe('completed');
    // The review is now available, with both sides of each answer.
    expect(result.questions).toHaveLength(2);
    expect(result.questions[0]!.correctAnswer).toBeTruthy();
    expect(result.questions[0]!.submittedAnswer).toBeTruthy();
    await ctx.server.close();
  });

  it('scores a mixed exam correctly', async () => {
    const ctx = await setup();
    const { id, body } = await playWholeExam(ctx, true);
    // Re-run the second question wrongly by ending early is not possible, so a
    // fresh exam answers the first right and the second wrong.
    const fresh = await setup();
    const started = await startExam(fresh.server, fresh.cookie);
    const q1 = await nextQuestion(fresh.server, fresh.cookie, started.id!);
    await fresh.server.inject({
      method: 'POST',
      url: `/api/v1/exams/${started.id}/answer`,
      headers: { cookie: fresh.cookie },
      payload: {
        vocabularyEntryId: q1!.vocabularyEntryId,
        direction: 'english-to-german',
        submittedAnswer: germanFor(q1!.vocabularyEntryId),
      },
    });
    const q2 = await nextQuestion(fresh.server, fresh.cookie, started.id!);
    await fresh.server.inject({
      method: 'POST',
      url: `/api/v1/exams/${started.id}/answer`,
      headers: { cookie: fresh.cookie },
      payload: {
        vocabularyEntryId: q2!.vocabularyEntryId,
        direction: 'english-to-german',
        submittedAnswer: 'wrong',
      },
    });
    const ended = await fresh.server.inject({
      method: 'POST',
      url: `/api/v1/exams/${started.id}/end`,
      headers: { cookie: fresh.cookie },
    });
    const result = (
      ended.json() as { result: { correctCount: number; score: number; incorrectCount: number } }
    ).result;
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(1);
    expect(result.score).toBe(50);
    void id;
    void body;
    await ctx.server.close();
    await fresh.server.close();
  });

  it('does not record an exam left part-way as completed', async () => {
    const { server, cookie, database } = await setup();
    const { id } = await startExam(server, cookie);
    const question = await nextQuestion(server, cookie, id!);
    await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/answer`,
      headers: { cookie },
      payload: {
        vocabularyEntryId: question!.vocabularyEntryId,
        direction: 'english-to-german',
        submittedAnswer: 'Apfel',
      },
    });
    const history = await server.inject({
      method: 'GET',
      url: '/api/v1/exams',
      headers: { cookie },
    });
    expect((history.json() as { history: unknown[] }).history).toHaveLength(0);
    const statistics = getExamStatistics(database, userIdOf(database), 10);
    expect(statistics.examsCompleted).toBe(0);
    await server.close();
  });
});

describe('exam history and statistics', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('aggregates server-side and returns a bounded trend', async () => {
    const { server, cookie, database } = await setup();
    const userId = userIdOf(database);
    for (let i = 0; i < 3; i += 1) {
      const { id } = await startExam(server, cookie);
      for (let q = 0; q < 2; q += 1) {
        const question = await nextQuestion(server, cookie, id!);
        await server.inject({
          method: 'POST',
          url: `/api/v1/exams/${id}/answer`,
          headers: { cookie },
          payload: {
            vocabularyEntryId: question!.vocabularyEntryId,
            direction: 'english-to-german',
            submittedAnswer: q === 0 ? germanFor(question!.vocabularyEntryId) : 'wrong',
          },
        });
      }
      await server.inject({ method: 'POST', url: `/api/v1/exams/${id}/end`, headers: { cookie } });
    }
    const history = await server.inject({
      method: 'GET',
      url: '/api/v1/exams',
      headers: { cookie },
    });
    const entries = (history.json() as { history: Array<{ score: number }> }).history;
    expect(entries).toHaveLength(3);
    for (const entry of entries) expect(entry.score).toBe(50);

    const statistics = getExamStatistics(database, userId, 30);
    expect(statistics.examsCompleted).toBe(3);
    expect(statistics.averageScore).toBe(50);
    expect(statistics.bestScore).toBe(50);
    expect(statistics.latestScore).toBe(50);
    expect(statistics.scoreHistory).toEqual([50, 50, 50]);
    expect(statistics.totalQuestionsAnswered).toBe(3);
    await server.close();
  });

  it('reports zeroes rather than undefined before any exam', async () => {
    const { server, cookie, database } = await setup();
    const statistics = getExamStatistics(database, userIdOf(database), 30);
    expect(statistics).toEqual({
      examsCompleted: 0,
      averageScore: 0,
      bestScore: 0,
      latestScore: 0,
      totalQuestionsAnswered: 0,
      scoreHistory: [],
    });
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/exams/statistics',
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    await server.close();
  });
});

describe('exam authorization and integrity', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('will not show one user another user exam result', async () => {
    const a = await setup();
    const { id } = await startExam(a.server, a.cookie);
    for (let q = 0; q < 2; q += 1) {
      const question = await nextQuestion(a.server, a.cookie, id!);
      await a.server.inject({
        method: 'POST',
        url: `/api/v1/exams/${id}/answer`,
        headers: { cookie: a.cookie },
        payload: {
          vocabularyEntryId: question!.vocabularyEntryId,
          direction: 'english-to-german',
          submittedAnswer: germanFor(question!.vocabularyEntryId),
        },
      });
    }
    await a.server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/end`,
      headers: { cookie: a.cookie },
    });

    // A different account gets a 404, not the other user's result.
    const b = await setup();
    const response = await b.server.inject({
      method: 'GET',
      url: `/api/v1/exams/${id}`,
      headers: { cookie: b.cookie },
    });
    expect(response.statusCode).toBe(404);
    expect(JSON.stringify(response.json())).not.toMatch(/correctAnswer/);
    const history = await b.server.inject({
      method: 'GET',
      url: '/api/v1/exams',
      headers: { cookie: b.cookie },
    });
    expect((history.json() as { history: unknown[] }).history).toHaveLength(0);
    await a.server.close();
    await b.server.close();
  });

  it('requires an identity', async () => {
    const { server } = await setup();
    expect(
      (await server.inject({ method: 'POST', url: '/api/v1/exams', payload: {} })).statusCode,
    ).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/api/v1/exams' })).statusCode).toBe(401);
    expect(
      (await server.inject({ method: 'GET', url: '/api/v1/exams/statistics' })).statusCode,
    ).toBe(401);
    await server.close();
  });

  it('scores on the server, ignoring any client-supplied score', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    for (let q = 0; q < 2; q += 1) {
      const question = await nextQuestion(server, cookie, id!);
      await server.inject({
        method: 'POST',
        url: `/api/v1/exams/${id}/answer`,
        headers: { cookie },
        payload: {
          vocabularyEntryId: question!.vocabularyEntryId,
          direction: 'english-to-german',
          submittedAnswer: 'wrong',
          // A client trying to award itself points.
          scoreDelta: 10,
          correct: true,
        },
      });
    }
    const ended = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/end`,
      headers: { cookie },
    });
    const result = (ended.json() as { result: { score: number; correctCount: number } }).result;
    expect(result.correctCount).toBe(0);
    expect(result.score).toBe(0);
    await server.close();
  });
});

describe('guest exams stay in memory', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('produces results and statistics with no database rows', async () => {
    const { server, cookie, database } = await guestSetup();
    const before = Number(
      (database.prepare('SELECT COUNT(*) AS c FROM practice_sessions').get() as { c: number }).c,
    );
    const { id } = await startExam(server, cookie);
    for (let q = 0; q < 2; q += 1) {
      const question = await nextQuestion(server, cookie, id!);
      await server.inject({
        method: 'POST',
        url: `/api/v1/exams/${id}/answer`,
        headers: { cookie },
        payload: {
          vocabularyEntryId: question!.vocabularyEntryId,
          direction: 'english-to-german',
          submittedAnswer: q === 0 ? germanFor(question!.vocabularyEntryId) : 'wrong',
        },
      });
    }
    const ended = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/end`,
      headers: { cookie },
    });
    const result = (ended.json() as { result: { score: number; questions: unknown[] } }).result;
    expect(result.score).toBe(50);
    expect(result.questions).toHaveLength(2);

    const statistics = await server.inject({
      method: 'GET',
      url: '/api/v1/exams/statistics',
      headers: { cookie },
    });
    expect(
      (statistics.json() as { statistics: { examsCompleted: number } }).statistics.examsCompleted,
    ).toBe(1);

    // Nothing about the guest exam reached the database.
    const after = Number(
      (database.prepare('SELECT COUNT(*) AS c FROM practice_sessions').get() as { c: number }).c,
    );
    expect(after).toBe(before);
    await server.close();
  });
});

/** The single user created by `setup`. */
function userIdOf(database: SqliteDatabase): string {
  return (database.prepare('SELECT id FROM users LIMIT 1').get() as { id: string }).id;
}
