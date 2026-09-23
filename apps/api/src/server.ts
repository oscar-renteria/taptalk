import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import {
  practiceDirectionSchema,
  registrationErrors,
  registrationSchema,
  userPreferencesSchema,
} from '@taptalk/shared';
import { createId, openDatabase, type SqliteDatabase } from './database.js';
import {
  commitVocabularyImport,
  countIncorrectAttemptsInSession,
  endPracticeSession,
  ensurePreferences,
  findUserByUsername,
  getDashboardSummary,
  getLastAttemptedEntryInSession,
  getVocabularyImportHistory,
  getPracticeSession,
  getPracticeSessionSummary,
  getPreferences,
  getSelectionCandidates,
  getVocabulary,
  insertUser,
  recordAttempt,
  startPracticeSession,
  updatePreferences,
  RepositoryError,
  type PracticeSessionRecord,
} from './repositories.js';
import { calculateScore } from './learning.js';
import { matchAnswer } from './matching.js';
import { resolveDirection, selectQuestion, type Random } from './selection.js';
import { previewVocabularyImport } from './vocabulary.js';
import { createRateLimiter, type RateLimitOptions } from './rate-limit.js';
import {
  clearedSessionCookie,
  createAccessGuard,
  createSession,
  currentUser,
  hashPassword,
  readSessionToken,
  revokeSession,
  sessionCookie,
  verifyLogin,
} from './auth.js';

function safeUser(user: {
  id: string;
  username: string;
  role: 'user' | 'administrator';
  createdAt: string;
}) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function publicSession<T extends PracticeSessionRecord>(session: T): Omit<T, 'userId'> {
  const rest: Omit<T, 'userId'> & { userId?: string } = { ...session };
  delete rest.userId;
  return rest;
}

export type ServerOptions = {
  // Per-IP limit shared by login and registration attempts.
  authRateLimit?: RateLimitOptions;
  // Adds the Secure cookie attribute; defaults to true in production.
  secureCookies?: boolean;
  // Source of randomness for question selection; injectable for deterministic tests.
  random?: Random;
};

const defaultAuthRateLimit: RateLimitOptions = {
  max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 20),
  windowMs: 15 * 60 * 1000,
};

export function buildServer(
  database: SqliteDatabase = openDatabase(),
  options: ServerOptions = {},
) {
  const server = Fastify({ logger: true });
  const authLimiter = createRateLimiter(options.authRateLimit ?? defaultAuthRateLimit);
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  const random = options.random ?? Math.random;

  server.decorateRequest('user', null);
  server.addHook('preHandler', createAccessGuard(database));

  function rejectIfRateLimited(request: FastifyRequest, reply: FastifyReply): boolean {
    const decision = authLimiter.check(request.ip);
    if (decision.allowed) return false;
    void reply
      .code(429)
      .header('retry-after', String(decision.retryAfterSeconds))
      .send({
        error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again in a few minutes.' },
      });
    return true;
  }

  // Unexpected failures (for example database errors) never expose internals to the client.
  server.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    if (statusCode >= 500) {
      request.log.error({ err: error }, 'request failed');
      return reply
        .code(500)
        .send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Try again.' } });
    }
    return reply
      .code(statusCode)
      .send({ error: { code: 'BAD_REQUEST', message: 'The request is invalid.' } });
  });

  server.get('/health', async () => ({ status: 'ok' }));

  server.post<{ Body: { username?: unknown; password?: unknown } }>(
    '/api/v1/auth/register',
    { config: { access: 'public' } },
    async (request, reply) => {
      if (rejectIfRateLimited(request, reply)) return reply;
      const parsed = registrationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: {
            code: 'INVALID_REGISTRATION',
            message: 'Check the highlighted fields.',
            details: registrationErrors(request.body),
          },
        });
      }
      const now = new Date().toISOString();
      const user = {
        id: createId(),
        username: parsed.data.username,
        passwordHash: hashPassword(parsed.data.password),
        role: 'user' as const,
        createdAt: now,
        updatedAt: now,
      };
      let token: string;
      database.exec('BEGIN');
      try {
        insertUser(database, user);
        ensurePreferences(database, user.id, now);
        token = createSession(database, user.id, now);
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        if (error instanceof RepositoryError && error.code === 'conflict') {
          return reply
            .code(409)
            .send({ error: { code: 'USERNAME_UNAVAILABLE', message: 'Username is unavailable.' } });
        }
        throw error;
      }
      reply.header('set-cookie', sessionCookie(token, secureCookies));
      return reply.code(201).send({ user: safeUser(user) });
    },
  );

  server.post<{ Body: { username?: unknown; password?: unknown } }>(
    '/api/v1/auth/login',
    { config: { access: 'public' } },
    async (request, reply) => {
      if (rejectIfRateLimited(request, reply)) return reply;
      const { username, password } = request.body ?? {};
      const user =
        typeof username === 'string' && username.length <= 64
          ? findUserByUsername(database, username.trim())
          : undefined;
      // Oversized passwords are not hashed, which bounds the scrypt cost per request.
      const candidate = typeof password === 'string' && password.length <= 128 ? password : '';
      const valid = verifyLogin(candidate, user?.passwordHash) && candidate === password;
      if (!user || !valid) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_LOGIN', message: 'Username or password is invalid.' } });
      }
      const token = createSession(database, user.id, new Date().toISOString());
      reply.header('set-cookie', sessionCookie(token, secureCookies));
      return reply.send({ user: safeUser(user) });
    },
  );

  server.get('/api/v1/auth/me', async (request, reply) => {
    const user = currentUser(request);
    return reply.send({ user: safeUser(user) });
  });

  server.post<{ Body: { content?: unknown; sourceName?: unknown } }>(
    '/api/v1/admin/vocabulary/preview',
    { config: { access: 'administrator' } },
    async (request, reply) => {
      const { content, sourceName } = request.body;
      if (typeof content !== 'string' || content.length > 1_000_000) {
        return reply.code(413).send({
          error: { code: 'IMPORT_TOO_LARGE', message: 'Import content is invalid or too large.' },
        });
      }
      const preview = previewVocabularyImport(
        content,
        getVocabulary(database).map((entry) => entry.english),
      );
      return reply.send({
        sourceName: typeof sourceName === 'string' ? sourceName : null,
        preview,
      });
    },
  );

  server.post<{ Body: { content?: unknown; sourceName?: unknown; confirm?: unknown } }>(
    '/api/v1/admin/vocabulary/import',
    { config: { access: 'administrator' } },
    async (request, reply) => {
      const user = currentUser(request);
      const { content, sourceName, confirm } = request.body;
      if (typeof content !== 'string' || content.length > 1_000_000) {
        return reply.code(413).send({
          error: { code: 'IMPORT_TOO_LARGE', message: 'Import content is invalid or too large.' },
        });
      }
      if (confirm !== true) {
        return reply.code(400).send({
          error: {
            code: 'CONFIRMATION_REQUIRED',
            message: 'Confirm the reviewed preview before importing.',
          },
        });
      }
      const preview = previewVocabularyImport(
        content,
        getVocabulary(database).map((entry) => entry.english),
      );
      if (
        preview.invalid.length > 0 ||
        preview.duplicates.length > 0 ||
        preview.valid.length === 0
      ) {
        return reply.code(422).send({
          error: {
            code: 'INVALID_IMPORT',
            message: 'Import contains invalid or duplicate records.',
            preview,
          },
        });
      }
      const result = commitVocabularyImport(
        database,
        user.id,
        preview.valid,
        typeof sourceName === 'string' ? sourceName : null,
        new Date().toISOString(),
      );
      return reply.code(201).send({ result });
    },
  );

  server.get(
    '/api/v1/admin/vocabulary/imports',
    { config: { access: 'administrator' } },
    async (_request, reply) => {
      return reply.send({ imports: getVocabularyImportHistory(database) });
    },
  );

  server.get<{ Querystring: { direction?: string; practiceSessionId?: string } }>(
    '/api/v1/practice/question',
    async (request, reply) => {
      const user = currentUser(request);
      const preferences = getPreferences(database, user.id);
      const { practiceSessionId } = request.query;
      const practiceSession = practiceSessionId
        ? getPracticeSession(database, user.id, practiceSessionId)
        : undefined;
      if (practiceSessionId && !practiceSession) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      if (practiceSession && practiceSession.status !== 'active') {
        return reply.code(409).send({
          error: { code: 'SESSION_NOT_ACTIVE', message: 'Practice session is no longer active.' },
        });
      }
      // A session fixes the direction; otherwise the query or the saved preference applies.
      const direction = practiceDirectionSchema.safeParse(
        practiceSession?.direction ?? request.query.direction ?? preferences.direction,
      );
      if (!direction.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_DIRECTION', message: 'Practice direction is invalid.' },
        });
      }
      const selection = selectQuestion(
        getSelectionCandidates(database, user.id, practiceSession?.id ?? null),
        {
          repetitionPreference: preferences.repetitionPreference,
          previousEntryId: practiceSession
            ? getLastAttemptedEntryInSession(database, practiceSession.id)
            : null,
        },
        random,
      );
      const entry = selection
        ? getVocabulary(database).find((candidate) => candidate.id === selection.id)
        : undefined;
      if (!selection || !entry) {
        return reply
          .code(404)
          .send({ error: { code: 'NO_VOCABULARY', message: 'No vocabulary is available.' } });
      }
      const resolvedDirection = resolveDirection(direction.data, random);
      return reply.send({
        question: {
          vocabularyEntryId: entry.id,
          direction: resolvedDirection,
          prompt: resolvedDirection === 'english-to-german' ? entry.english : entry.germanDisplay,
          phonetics: entry.phonetics,
          selectionReason: selection.reason,
        },
      });
    },
  );

  server.post<{
    Body: {
      vocabularyEntryId?: unknown;
      direction?: unknown;
      prompt?: unknown;
      submittedAnswer?: unknown;
      practiceSessionId?: unknown;
    };
  }>('/api/v1/practice/answer', async (request, reply) => {
    const user = currentUser(request);
    const { vocabularyEntryId, direction, prompt, submittedAnswer, practiceSessionId } =
      request.body;
    if (
      typeof vocabularyEntryId !== 'string' ||
      (direction !== 'english-to-german' && direction !== 'german-to-english') ||
      typeof prompt !== 'string' ||
      typeof submittedAnswer !== 'string' ||
      (practiceSessionId !== undefined && typeof practiceSessionId !== 'string')
    ) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ANSWER', message: 'Answer submission is invalid.' } });
    }
    const practiceSession =
      typeof practiceSessionId === 'string'
        ? getPracticeSession(database, user.id, practiceSessionId)
        : undefined;
    if (typeof practiceSessionId === 'string') {
      if (!practiceSession) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      if (
        practiceSession.status !== 'active' ||
        practiceSession.answeredCount >= practiceSession.questionCount
      ) {
        return reply.code(409).send({
          error: { code: 'SESSION_NOT_ACTIVE', message: 'Practice session is no longer active.' },
        });
      }
    }
    const entry = getVocabulary(database).find((candidate) => candidate.id === vocabularyEntryId);
    if (!entry) {
      return reply.code(404).send({
        error: { code: 'QUESTION_NOT_FOUND', message: 'Question is no longer available.' },
      });
    }
    const acceptedAnswers = direction === 'english-to-german' ? entry.answers : [entry.english];
    const match = matchAnswer(submittedAnswer, acceptedAnswers);
    const priorErrors = practiceSession
      ? countIncorrectAttemptsInSession(database, practiceSession.id, entry.id)
      : 0;
    const scoreDelta = calculateScore(match.correct, priorErrors);
    const attemptId = createId();
    recordAttempt(database, {
      id: attemptId,
      userId: user.id,
      vocabularyEntryId: entry.id,
      direction,
      prompt,
      submittedAnswer,
      normalizedAnswer: match.normalizedAnswer,
      correct: match.correct,
      scoreDelta,
      matchingReason: match.reason,
      attemptedAt: new Date().toISOString(),
      practiceSessionId: practiceSession?.id ?? null,
    });
    return reply.send({
      result: {
        attemptId,
        correct: match.correct,
        scoreDelta,
        matchingReason: match.reason,
        correctAnswer: direction === 'english-to-german' ? entry.germanDisplay : entry.english,
      },
      ...(practiceSession
        ? {
            session: {
              id: practiceSession.id,
              answeredCount: practiceSession.answeredCount + 1,
              questionCount: practiceSession.questionCount,
            },
          }
        : {}),
    });
  });

  server.post<{ Body: { direction?: unknown } | undefined }>(
    '/api/v1/practice/sessions',
    async (request, reply) => {
      const user = currentUser(request);
      const preferences = getPreferences(database, user.id);
      const direction = practiceDirectionSchema.safeParse(
        request.body?.direction ?? preferences.direction,
      );
      if (!direction.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_DIRECTION', message: 'Practice direction is invalid.' },
        });
      }
      if (getVocabulary(database).length === 0) {
        return reply
          .code(404)
          .send({ error: { code: 'NO_VOCABULARY', message: 'No vocabulary is available.' } });
      }
      const session = startPracticeSession(
        database,
        {
          id: createId(),
          userId: user.id,
          direction: direction.data,
          questionCount: preferences.sessionLength,
        },
        new Date().toISOString(),
      );
      return reply.code(201).send({ session: publicSession(session) });
    },
  );

  server.get<{ Params: { sessionId: string } }>(
    '/api/v1/practice/sessions/:sessionId',
    async (request, reply) => {
      const user = currentUser(request);
      const summary = getPracticeSessionSummary(database, user.id, request.params.sessionId);
      if (!summary) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      return reply.send({ session: publicSession(summary) });
    },
  );

  server.post<{ Params: { sessionId: string } }>(
    '/api/v1/practice/sessions/:sessionId/end',
    async (request, reply) => {
      const user = currentUser(request);
      const session = getPracticeSession(database, user.id, request.params.sessionId);
      if (!session) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      if (session.status === 'active') {
        endPracticeSession(database, session, new Date().toISOString());
      }
      const summary = getPracticeSessionSummary(database, user.id, session.id);
      return reply.send({ session: summary ? publicSession(summary) : null });
    },
  );

  server.get('/api/v1/dashboard', async (request, reply) => {
    const user = currentUser(request);
    return reply.send({ dashboard: getDashboardSummary(database, user.id) });
  });

  server.get('/api/v1/settings', async (request, reply) => {
    const user = currentUser(request);
    return reply.send({ settings: getPreferences(database, user.id) });
  });

  server.put<{ Body: unknown }>('/api/v1/settings', async (request, reply) => {
    const user = currentUser(request);
    const parsed = userPreferencesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_SETTINGS', message: 'Practice settings are invalid.' } });
    }
    return reply.send({
      settings: updatePreferences(database, user.id, parsed.data, new Date().toISOString()),
    });
  });

  server.post('/api/v1/auth/logout', { config: { access: 'public' } }, async (request, reply) => {
    const token = readSessionToken(request);
    if (token) {
      revokeSession(database, token, new Date().toISOString());
    }
    reply.header('set-cookie', clearedSessionCookie(secureCookies));
    return reply.code(204).send();
  });

  return server;
}

const server = buildServer();
const port = Number(process.env.API_PORT ?? 3000);

if (process.env.NODE_ENV !== 'test') {
  server.listen({ host: '0.0.0.0', port }).catch((error: unknown) => {
    server.log.error(error);
    process.exit(1);
  });
}
