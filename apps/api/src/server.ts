import Fastify from 'fastify';
import { userPreferencesSchema } from '@taptalk/shared';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createId, openDatabase, type SqliteDatabase } from './database.js';
import {
  commitVocabularyImport,
  ensurePreferences,
  findUserByUsername,
  getDashboardSummary,
  getVocabularyImportHistory,
  getPreferences,
  getVocabulary,
  insertUser,
  recordAttempt,
  updatePreferences,
} from './repositories.js';
import { calculateScore, matchAnswer } from './learning.js';
import { previewVocabularyImport } from './vocabulary.js';

const sessionCookieName = 'taptalk_session';
const sessionDurationMs = 1000 * 60 * 60 * 24 * 14;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHash] = storedHash.split(':');
  if (!salt || !expectedHash) {
    return false;
  }
  const actualHash = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  return actualHash.length === expectedBuffer.length && timingSafeEqual(actualHash, expectedBuffer);
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function setSessionCookie(
  reply: { header: (name: string, value: string) => void },
  token: string,
): void {
  reply.header(
    'set-cookie',
    `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDurationMs / 1000}`,
  );
}

function readSessionToken(request: {
  headers: Record<string, string | string[] | undefined>;
}): string | undefined {
  const cookieHeader = request.headers.cookie;
  const cookie = Array.isArray(cookieHeader) ? cookieHeader.join(';') : cookieHeader;
  return cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${sessionCookieName}=`))
    ?.slice(sessionCookieName.length + 1);
}

function safeUser(user: {
  id: string;
  username: string;
  role: 'user' | 'administrator';
  createdAt: string;
}) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function findAuthenticatedUser(
  database: SqliteDatabase,
  request: { headers: Record<string, string | string[] | undefined> },
) {
  const token = readSessionToken(request);
  return token
    ? (database
        .prepare(
          `SELECT u.id, u.username, u.role, u.created_at AS createdAt FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
        )
        .get(hashSessionToken(token), new Date().toISOString()) as
        | { id: string; username: string; role: 'user' | 'administrator'; createdAt: string }
        | undefined)
    : undefined;
}

export function buildServer(database: SqliteDatabase = openDatabase()) {
  const server = Fastify({ logger: true });

  server.get('/health', async () => ({ status: 'ok' }));

  server.post<{ Body: { username?: unknown; password?: unknown } }>(
    '/api/v1/auth/register',
    async (request, reply) => {
      const { username, password } = request.body;
      if (
        typeof username !== 'string' ||
        typeof password !== 'string' ||
        username.trim().length < 2 ||
        password.length < 8
      ) {
        return reply.code(400).send({
          error: { code: 'INVALID_CREDENTIALS', message: 'Username or password is invalid.' },
        });
      }
      const now = new Date().toISOString();
      const user = {
        id: createId(),
        username: username.trim(),
        passwordHash: hashPassword(password),
        role: 'user' as const,
        createdAt: now,
        updatedAt: now,
      };
      try {
        insertUser(database, user);
        ensurePreferences(database, user.id, now);
      } catch {
        return reply
          .code(409)
          .send({ error: { code: 'USERNAME_UNAVAILABLE', message: 'Username is unavailable.' } });
      }
      const token = randomBytes(32).toString('base64url');
      database
        .prepare(
          'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          createId(),
          user.id,
          hashSessionToken(token),
          new Date(Date.now() + sessionDurationMs).toISOString(),
          now,
        );
      setSessionCookie(reply, token);
      return reply.code(201).send({ user: safeUser(user) });
    },
  );

  server.post<{ Body: { username?: unknown; password?: unknown } }>(
    '/api/v1/auth/login',
    async (request, reply) => {
      const { username, password } = request.body;
      const user =
        typeof username === 'string' && typeof password === 'string'
          ? findUserByUsername(database, username.trim())
          : undefined;
      if (!user || !verifyPassword(password as string, user.passwordHash)) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_LOGIN', message: 'Username or password is invalid.' } });
      }
      const now = new Date().toISOString();
      const token = randomBytes(32).toString('base64url');
      database
        .prepare(
          'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          createId(),
          user.id,
          hashSessionToken(token),
          new Date(Date.now() + sessionDurationMs).toISOString(),
          now,
        );
      setSessionCookie(reply, token);
      return reply.send({ user: safeUser(user) });
    },
  );

  server.get('/api/v1/auth/me', async (request, reply) => {
    const user = findAuthenticatedUser(database, request);
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
    return reply.send({ user: safeUser(user) });
  });

  server.post<{ Body: { content?: unknown; sourceName?: unknown } }>(
    '/api/v1/admin/vocabulary/preview',
    async (request, reply) => {
      const user = findAuthenticatedUser(database, request);
      if (!user) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
      }
      if (user.role !== 'administrator') {
        return reply
          .code(403)
          .send({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
      }
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
    async (request, reply) => {
      const user = findAuthenticatedUser(database, request);
      if (!user) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
      }
      if (user.role !== 'administrator') {
        return reply
          .code(403)
          .send({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
      }
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

  server.get('/api/v1/admin/vocabulary/imports', async (request, reply) => {
    const user = findAuthenticatedUser(database, request);
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
    if (user.role !== 'administrator') {
      return reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
    }
    return reply.send({ imports: getVocabularyImportHistory(database) });
  });

  server.get<{ Querystring: { direction?: string } }>(
    '/api/v1/practice/question',
    async (request, reply) => {
      const user = findAuthenticatedUser(database, request);
      if (!user) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
      }
      const direction = request.query.direction ?? getPreferences(database, user.id).direction;
      if (!['english-to-german', 'german-to-english', 'random'].includes(direction)) {
        return reply.code(400).send({
          error: { code: 'INVALID_DIRECTION', message: 'Practice direction is invalid.' },
        });
      }
      const entries = getVocabulary(database);
      if (entries.length === 0) {
        return reply
          .code(404)
          .send({ error: { code: 'NO_VOCABULARY', message: 'No vocabulary is available.' } });
      }
      const entry = entries[0];
      if (!entry) {
        return reply
          .code(404)
          .send({ error: { code: 'NO_VOCABULARY', message: 'No vocabulary is available.' } });
      }
      const resolvedDirection = direction === 'random' ? 'english-to-german' : direction;
      return reply.send({
        question: {
          vocabularyEntryId: entry.id,
          direction: resolvedDirection,
          prompt: resolvedDirection === 'english-to-german' ? entry.english : entry.germanDisplay,
          phonetics: entry.phonetics,
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
    };
  }>('/api/v1/practice/answer', async (request, reply) => {
    const user = findAuthenticatedUser(database, request);
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
    const { vocabularyEntryId, direction, prompt, submittedAnswer } = request.body;
    if (
      typeof vocabularyEntryId !== 'string' ||
      (direction !== 'english-to-german' && direction !== 'german-to-english') ||
      typeof prompt !== 'string' ||
      typeof submittedAnswer !== 'string'
    ) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ANSWER', message: 'Answer submission is invalid.' } });
    }
    const entry = getVocabulary(database).find((candidate) => candidate.id === vocabularyEntryId);
    if (!entry) {
      return reply.code(404).send({
        error: { code: 'QUESTION_NOT_FOUND', message: 'Question is no longer available.' },
      });
    }
    const acceptedAnswers = direction === 'english-to-german' ? entry.answers : [entry.english];
    const match = matchAnswer(submittedAnswer, acceptedAnswers);
    const scoreDelta = calculateScore(match.correct, 0);
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
    });
    return reply.send({
      result: {
        attemptId,
        correct: match.correct,
        scoreDelta,
        matchingReason: match.reason,
        correctAnswer: direction === 'english-to-german' ? entry.germanDisplay : entry.english,
      },
    });
  });

  server.get('/api/v1/dashboard', async (request, reply) => {
    const user = findAuthenticatedUser(database, request);
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
    return reply.send({ dashboard: getDashboardSummary(database, user.id) });
  });

  server.get('/api/v1/settings', async (request, reply) => {
    const user = findAuthenticatedUser(database, request);
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
    return reply.send({ settings: getPreferences(database, user.id) });
  });

  server.put<{ Body: unknown }>('/api/v1/settings', async (request, reply) => {
    const user = findAuthenticatedUser(database, request);
    if (!user) {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
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

  server.post('/api/v1/auth/logout', async (request, reply) => {
    const token = readSessionToken(request);
    if (token) {
      database
        .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
        .run(new Date().toISOString(), hashSessionToken(token));
    }
    reply.header('set-cookie', `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
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
