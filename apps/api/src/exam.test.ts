import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { openDatabase, type SqliteDatabase } from './database.js';
import { resetGuestStore } from './guest-store.js';
import { examScore, getExamStatistics } from './repositories.js';

const now = '2026-01-01T00:00:00.000Z';

/** The fixture keyed by the English prompt an exam actually shows. */
const germanByPrompt = new Map([
  ['apple', 'Apfel'],
  ['house', 'Haus'],
  ['car', 'Auto'],
]);

/** Three entries, so an exam is short and the pool can be smaller than a request. */
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
  await server.inject({
    method: 'PUT',
    url: '/api/v1/settings',
    headers: { cookie },
    payload: {
      direction: 'english-to-german',
      sessionLength: 10,
      repetitionPreference: 'balanced',
    },
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
    payload: {
      direction: 'english-to-german',
      sessionLength: 10,
      repetitionPreference: 'balanced',
    },
  });
  return { database, server, cookie };
}

/**
 * The German answer for the prompt an exam served. Which entry an exam asks is
 * weighted and not predictable, so tests read the answer rather than assume one.
 */
function germanFor(prompt: string): string {
  const row = germanByPrompt.get(prompt);
  if (!row) throw new Error(`Unknown fixture entry ${prompt}`);
  return row;
}

const startExam = async (
  server: ReturnType<typeof buildServer>,
  cookie: string,
  questionCount?: number,
) => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/v1/exams',
    headers: { cookie },
    payload: { direction: 'english-to-german', ...(questionCount ? { questionCount } : {}) },
  });
  const body = response.json() as { session?: { id: string; questionCount: number } };
  return {
    status: response.statusCode,
    id: body.session?.id,
    questionCount: body.session?.questionCount,
  };
};

type ServedQuestion = { position: number; direction: string; prompt: string };

const nextQuestion = async (
  server: ReturnType<typeof buildServer>,
  cookie: string,
  examId: string,
): Promise<ServedQuestion | undefined> => {
  const response = await server.inject({
    method: 'GET',
    url: `/api/v1/exams/${examId}/question`,
    headers: { cookie },
  });
  return (response.json() as { question?: ServedQuestion }).question;
};

const answer = async (
  server: ReturnType<typeof buildServer>,
  cookie: string,
  examId: string,
  position: number,
  submittedAnswer: string,
) =>
  server.inject({
    method: 'POST',
    url: `/api/v1/exams/${examId}/answer`,
    headers: { cookie },
    payload: { position, submittedAnswer },
  });

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

describe('an active exam reveals nothing about correctness', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  it('returns position only, with no correctness anywhere in the payload', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    const question = await nextQuestion(server, cookie, id!);

    const response = await answer(
      server,
      cookie,
      id!,
      question!.position,
      germanFor(question!.prompt),
    );
    const body = JSON.stringify(response.json());
    expect(response.statusCode).toBe(200);
    // The whole response body is the assertion. Not merely "no answer", but no
    // correctness either: the client is never told, so it cannot leak.
    expect(body).not.toMatch(/correct|score|reason|delta/i);
    expect(body).not.toMatch(/Apfel|Haus|Auto/);
    expect(response.json()).toEqual({
      session: { answeredCount: 1, questionCount: 3, complete: false },
    });
    await server.close();
  });

  it('does not reveal the answer after an incorrect answer either', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    const question = await nextQuestion(server, cookie, id!);
    const response = await answer(server, cookie, id!, question!.position, 'nonsense');
    const body = JSON.stringify(response.json());
    expect(body).not.toMatch(/correct|score|reason/i);
    expect(body).not.toMatch(/nonsense/);
    // A wrong answer advances the exam exactly like a right one, which is the
    // only difference the client is permitted to observe.
    expect(response.json()).toMatchObject({ session: { answeredCount: 1 } });
    await server.close();
  });

  it('refuses a position the exam never asked, so a client cannot pick its own', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    // Skipping ahead.
    expect((await answer(server, cookie, id!, 3, 'anything')).statusCode).toBe(400);
    // And going backwards.
    expect((await answer(server, cookie, id!, 0, 'anything')).statusCode).toBe(400);
    await server.close();
  });

  it('ignores a client that claims its own score', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    // A client cannot claim 100%: the score is computed from stored answers.
    await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/answer`,
      headers: { cookie },
      payload: {
        position: 1,
        submittedAnswer: 'wrong',
        score: 100,
        correctCount: 3,
        correctAnswers: 3,
      },
    });
    await answer(server, cookie, id!, 2, 'wrong');
    const question = await nextQuestion(server, cookie, id!);
    await answer(server, cookie, id!, 3, germanFor(question!.prompt));
    const ended = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/end`,
      headers: { cookie },
    });
    const { result } = ended.json() as { result: { score: number; correctCount: number } };
    // One real answer was right, whatever the client claimed.
    expect(result.correctCount).toBe(1);
    expect(result.score).toBe(33);
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
    // Fill the exam. The pool holds three entries, so the exam is three long.
    for (let position = 1; position <= 3; position += 1) {
      const question = await nextQuestion(server, cookie, id!);
      const response = await answer(server, cookie, id!, position, germanFor(question!.prompt));
      expect(response.statusCode).toBe(200);
    }
    // A fourth submission cannot add to the score.
    expect((await answer(server, cookie, id!, 4, 'Apfel')).statusCode).toBe(409);
    await server.close();
  });
});

describe('exam completion and results', () => {
  beforeEach(() => {
    resetGuestStore();
  });

  /**
   * Plays the whole exam, answering every question the same way.
   *
   * The pool holds three entries, so the exam is three questions long.
   */
  async function playWholeExam(
    ctx: Awaited<ReturnType<typeof setup>>,
    correctEvery: boolean,
    correctPositions: number[] = [],
  ) {
    const { server, cookie } = ctx;
    const { id } = await startExam(server, cookie);
    for (let position = 1; position <= 3; position += 1) {
      const question = await nextQuestion(server, cookie, id!);
      const right = correctEvery || correctPositions.includes(position);
      await answer(server, cookie, id!, position, right ? germanFor(question!.prompt) : 'wrong');
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
    expect(result.totalQuestions).toBe(3);
    expect(result.correctCount).toBe(3);
    expect(result.incorrectCount).toBe(0);
    expect(result.score).toBe(100);
    expect(result.status).toBe('completed');
    // The review is now available, with both sides of each answer.
    expect(result.questions).toHaveLength(3);
    expect(result.questions[0]!.correctAnswer).toBeTruthy();
    expect(result.questions[0]!.submittedAnswer).toBeTruthy();
    await ctx.server.close();
  });

  it('scores a mixed exam correctly', async () => {
    const fresh = await setup();
    // One of three right: 1/3 rounds to 33, not 33.3.
    const { body } = await playWholeExam(fresh, false, [2]);
    const result = body.result as { correctCount: number; score: number; incorrectCount: number };
    expect(result.correctCount).toBe(1);
    expect(result.incorrectCount).toBe(2);
    expect(result.score).toBe(33);
    await fresh.server.close();
  });

  it('completes the exam on the last answer, without being asked', async () => {
    const { server, cookie } = await setup();
    const { id } = await startExam(server, cookie);
    for (let position = 1; position <= 2; position += 1) {
      const question = await nextQuestion(server, cookie, id!);
      const response = await answer(server, cookie, id!, position, germanFor(question!.prompt));
      expect(response.json()).toMatchObject({ session: { complete: false } });
    }
    const question = await nextQuestion(server, cookie, id!);
    const last = await answer(server, cookie, id!, 3, germanFor(question!.prompt));
    // The response says the exam is complete, and the session really is finished:
    // the result is readable without ever calling /end.
    expect(last.json()).toMatchObject({ session: { complete: true } });
    const result = await server.inject({
      method: 'GET',
      url: `/api/v1/exams/${id}`,
      headers: { cookie },
    });
    expect(result.statusCode).toBe(200);
    expect((result.json() as { result: { status: string } }).result.status).toBe('completed');
    await server.close();
  });

  it('does not record an exam left part-way as completed', async () => {
    const { server, cookie, database } = await setup();
    const { id } = await startExam(server, cookie);
    const question = await nextQuestion(server, cookie, id!);
    await answer(server, cookie, id!, question!.position, 'Apfel');
    // Leaving is explicit, and is recorded as abandoned rather than completed.
    const left = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/abandon`,
      headers: { cookie },
    });
    expect(left.statusCode).toBe(200);
    const session = database
      .prepare(`SELECT status FROM practice_sessions WHERE id = ?`)
      .get(id!) as { status: string };
    expect(session.status).toBe('abandoned');
    const history = await server.inject({
      method: 'GET',
      url: '/api/v1/exams',
      headers: { cookie },
    });
    expect((history.json() as { history: unknown[] }).history).toHaveLength(0);
    const statistics = getExamStatistics(database, userIdOf(database), 10);
    expect(statistics.examsCompleted).toBe(0);
    expect(statistics.averageScore).toBe(0);
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
      // Two of three right, so each exam scores 67%.
      for (let position = 1; position <= 3; position += 1) {
        const question = await nextQuestion(server, cookie, id!);
        await answer(
          server,
          cookie,
          id!,
          position,
          position <= 2 ? germanFor(question!.prompt) : 'wrong',
        );
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
    for (const entry of entries) expect(entry.score).toBe(67);

    const statistics = getExamStatistics(database, userId, 30);
    expect(statistics.examsCompleted).toBe(3);
    expect(statistics.averageScore).toBe(67);
    expect(statistics.bestScore).toBe(67);
    expect(statistics.latestScore).toBe(67);
    expect(statistics.scoreHistory).toEqual([67, 67, 67]);
    expect(statistics.totalQuestionsAnswered).toBe(9);
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
    for (let position = 1; position <= 3; position += 1) {
      const question = await nextQuestion(a.server, a.cookie, id!);
      await answer(a.server, a.cookie, id!, position, germanFor(question!.prompt));
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
    for (let position = 1; position <= 3; position += 1) {
      // A client trying to award itself points, and to declare itself right.
      await server.inject({
        method: 'POST',
        url: `/api/v1/exams/${id}/answer`,
        headers: { cookie },
        payload: {
          position,
          submittedAnswer: 'wrong',
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
    for (let position = 1; position <= 3; position += 1) {
      const question = await nextQuestion(server, cookie, id!);
      await answer(
        server,
        cookie,
        id!,
        position,
        position === 1 ? germanFor(question!.prompt) : 'wrong',
      );
    }
    const ended = await server.inject({
      method: 'POST',
      url: `/api/v1/exams/${id}/end`,
      headers: { cookie },
    });
    const result = (ended.json() as { result: { score: number; questions: unknown[] } }).result;
    // One of three right, so a guest is scored exactly as a user would be.
    expect(result.score).toBe(33);
    expect(result.questions).toHaveLength(3);

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
