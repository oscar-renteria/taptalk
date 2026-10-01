import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import type { ShareResultPayload, UserPreferences } from '@taptalk/shared';
import {
  createShareResultSchema,
  defaultExamLength,
  examLengthSchema,
  practiceDirectionSchema,
  practiceVocabularyExclusionsSchema,
  registrationErrors,
  registrationSchema,
  userPreferencesSchema,
} from '@taptalk/shared';
import { loadConfig, type AppConfig } from './config.js';
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
  getExamHistory,
  getExamResult,
  getExamStatistics,
  getPracticeVocabulary,
  countPracticeVocabulary,
  setPracticeVocabularyExclusions,
  createExamQuestionSet,
  getExamQuestionAt,
  getPreferences,
  getSelectionCandidates,
  getSharedResultByToken,
  getShareReferralStats,
  getVocabulary,
  insertUser,
  listSharedResults,
  markReferralConverted,
  readShareableResult,
  recordAttempt,
  recordReferralAttribution,
  createOrGetSharedResult,
  revokeSharedResult,
  startPracticeSession,
  updatePasswordHash,
  updatePreferences,
  RepositoryError,
  type PracticeSessionRecord,
  type VocabularyRecord,
} from './repositories.js';
import {
  buildSharePayload,
  createShareToken,
  hasScorableResult,
  isShareableStatus,
  isShareToken,
  sharePath,
} from './share.js';
import { clearedGuestCookie, createGuestId, guestCookie, signGuestToken } from './guest.js';
import * as guestStore from './guest-store.js';
import type { GuestAttempt } from './guest-store.js';
import { calculateScore } from './learning.js';
import { matchAnswer } from './matching.js';
import {
  resolveDirection,
  selectQuestion,
  type Random,
  type SelectionCandidate,
} from './selection.js';
import { previewVocabularyImport } from './vocabulary.js';
import { createRateLimiter, type RateLimitOptions } from './rate-limit.js';
import { apiSecurityHeaders, createOriginGuard } from './security.js';
import {
  clearedSessionCookie,
  createAccessGuard,
  createSession,
  currentActor,
  currentUser,
  hashPassword,
  needsRehash,
  readSessionToken,
  revokeSession,
  sessionCookie,
  verifyLogin,
} from './auth.js';

// --- Referral attribution cookie ----------------------------------------------
//
// A learner arriving from a shared result is attributed to that share when they
// later register or log in. The mechanism is a first-party cookie rather than
// localStorage, so nothing about the referral is readable by the page's own
// scripts and there is no persistent client-side tracking identifier.
//
// The cookie holds only the opaque public token. It confers nothing: the value
// is resolved through `recordReferralAttribution`, which refuses revoked shares
// and self-referral, so a tampered or replayed cookie cannot be used to
// impersonate the sharer or to attribute a signup to a share that does not
// exist.
export const referralCookieName = 'taptalk_referral';
export const referralDurationMs = 1000 * 60 * 60 * 24 * 30;

export function referralCookie(token: string, secure: boolean): string {
  return `${referralCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${referralDurationMs / 1000}${secure ? '; Secure' : ''}`;
}

export function clearedReferralCookie(secure: boolean): string {
  return `${referralCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readReferralToken(request: {
  headers: { cookie?: string | undefined };
}): string | null {
  const raw = request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${referralCookieName}=`))
    ?.slice(referralCookieName.length + 1);
  // A cookie value is attacker-controlled. Only the exact token shape is accepted,
  // so a tampered value can never reach a query as anything but an opaque string.
  return raw && isShareToken(decodeURIComponent(raw)) ? decodeURIComponent(raw) : null;
}

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

function isValidSourceName(value: unknown): boolean {
  return (
    value === undefined || value === null || (typeof value === 'string' && value.length <= 200)
  );
}

function rejectSourceName(reply: FastifyReply) {
  return reply.code(400).send({
    error: { code: 'INVALID_SOURCE_NAME', message: 'The file name is invalid or too long.' },
  });
}

export type ServerOptions = {
  // Per-IP limit shared by login and registration attempts.
  authRateLimit?: RateLimitOptions;
  // Adds the Secure cookie attribute; defaults to true in production.
  secureCookies?: boolean;
  // Source of randomness for question selection; injectable for deterministic tests.
  random?: Random;
  // Browser origins allowed to make state-changing requests (defaults to WEB_ORIGIN, comma
  // separated). Empty means "same host as the request".
  allowedOrigins?: string[];
  // Development-only CORS override. It is enabled by default in development, can be disabled for
  // focused tests, and is always ignored in production.
  allowAllOrigins?: boolean;
  // Destination for logs (defaults to stdout); tests pass a stream to inspect what is logged.
  logStream?: NodeJS.WritableStream;
  // Which proxies to trust for the client address (defaults to TRUST_PROXY). Must be set behind a
  // reverse proxy, otherwise every user shares the proxy's address and its rate limit.
  trustProxy?: boolean | string[];
  // Complete validated process configuration. Tests and embedded callers may provide one explicitly.
  config?: AppConfig;
  // Readiness probe state; production startup controls this while the server is initializing/draining.
  isReady?: () => boolean;
};

// TRUST_PROXY: "true" (trust any proxy, for a single reverse proxy in front of the API) or a
// comma-separated list of trusted proxy addresses or CIDR ranges.
export { parseTrustProxy } from './config.js';

// Refuses to start with settings that would silently lose data or weaken the runtime contract.
export function assertProductionConfiguration(environment: NodeJS.ProcessEnv): void {
  loadConfig(environment);
}

// Request bodies are small JSON documents, except vocabulary imports.
const defaultBodyLimit = 64 * 1024;
const importBodyLimit = 2 * 1024 * 1024;
const maxSubmittedAnswerLength = 500;
// The Progress page only needs recent exams listed, and a bounded trend for the
// chart, so neither endpoint ever returns an unbounded history.
const examHistoryLimit = 20;
const examTrendLimit = 30;

// Default request logging records method, URL, host and client address only. The redaction list
// guards against headers or credentials being added to log objects in the future.
const logRedaction = [
  'req.headers.cookie',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
  'body.password',
  'password',
  'passwordHash',
  'token',
];

export function buildServer(database?: SqliteDatabase, options: ServerOptions = {}) {
  const config = options.config ?? loadConfig();
  database ??= openDatabase(config.databasePath);
  // Narrowed alias: the parameter is optional, closures need a definite type.
  const db = database;
  const server = Fastify({
    logger: {
      level: config.logLevel,
      redact: { paths: logRedaction, censor: '[redacted]' },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    bodyLimit: defaultBodyLimit,
    trustProxy: options.trustProxy ?? config.trustProxy,
  });
  const allowAllOrigins = config.nodeEnv === 'development' && options.allowAllOrigins !== false;
  if (allowAllOrigins) {
    server.register(cors, {
      origin: true,
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    });
  }
  // Only JSON bodies are accepted. Removing the built-in text/plain parser means HTML forms, the
  // classic CSRF vector, cannot reach any handler (415 Unsupported Media Type).
  server.removeContentTypeParser('text/plain');
  const authLimiter = createRateLimiter(
    options.authRateLimit ?? { max: config.authRateLimitMax, windowMs: 15 * 60 * 1000 },
  );
  const secureCookies = options.secureCookies ?? config.nodeEnv === 'production';
  const random = options.random ?? Math.random;

  function isGuest(request: FastifyRequest): boolean {
    return currentActor(request).type === 'guest';
  }

  /** The acting id for stores that are keyed by identity: a user id or a guest id. */
  function actorId(request: FastifyRequest): string {
    const actor = currentActor(request);
    if (actor.type === 'guest') return actor.guestId;
    if (actor.type === 'authenticated') return actor.user.id;
    throw new Error('actorId() used on a route that allows anonymous access.');
  }

  // The Settings vocabulary list and the stored selection, by actor. Both resolve
  // from the same rows, so the list a user sees is the list Practice Mode uses.
  function readPracticeVocabulary(request: FastifyRequest) {
    const actor = currentActor(request);
    if (actor.type === 'guest') return guestStore.getPracticeVocabulary(actor.guestId, vocabulary);
    if (actor.type === 'authenticated') return getPracticeVocabulary(db, actor.user.id);
    return [];
  }

  function countPracticeVocabularyFor(request: FastifyRequest): number {
    const actor = currentActor(request);
    if (actor.type === 'guest')
      return guestStore.countPracticeVocabulary(actor.guestId, vocabulary);
    if (actor.type === 'authenticated') return countPracticeVocabulary(db, actor.user.id);
    return 0;
  }

  /**
   * The pool an exam draws from: the learner's enabled Practice Vocabulary,
   * chosen by actor exactly as Practice Mode chooses it.
   */
  function getSelectionCandidatesFor(
    request: FastifyRequest,
    sessionId: string | null,
  ): SelectionCandidate[] {
    const actor = currentActor(request);
    if (actor.type === 'guest')
      return guestStore.getSelectionCandidates(actor.guestId, sessionId, vocabulary);
    if (actor.type === 'authenticated') return getSelectionCandidates(db, actor.user.id, sessionId);
    return [];
  }

  // Vocabulary is shared, read-only content, so a guest reads it exactly as a user
  // does. Nothing here writes.
  const vocabulary = (): VocabularyRecord[] => getVocabulary(db);

  /**
   * Preferences, chosen by actor. A guest reads and writes the in-memory copy, so
   * `updatePreferences` for a guest can never reach user_preferences.
   */
  function readPreferences(request: FastifyRequest) {
    const actor = currentActor(request);
    return actor.type === 'guest'
      ? guestStore.getPreferences(actor.guestId)
      : getPreferences(db, actor.type === 'authenticated' ? actor.user.id : '');
  }

  function writePreferences(request: FastifyRequest, preferences: UserPreferences) {
    const actor = currentActor(request);
    return actor.type === 'guest'
      ? guestStore.updatePreferences(actor.guestId, preferences)
      : updatePreferences(
          db,
          actor.type === 'authenticated' ? actor.user.id : '',
          preferences,
          new Date().toISOString(),
        );
  }

  server.decorateRequest('user', null);
  server.addHook(
    'onRequest',
    createOriginGuard(options.allowedOrigins ?? config.webOrigins, allowAllOrigins),
  );
  server.addHook('preHandler', createAccessGuard(database, config.guestSessionSecret));
  // API responses contain personal data: never store them in browser, service worker, or proxy caches.
  server.addHook('onSend', async (request, reply) => {
    reply.headers(apiSecurityHeaders);
    if (request.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

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
    const clientErrors: Record<number, { code: string; message: string }> = {
      413: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large.' },
      415: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'Send the request as JSON.' },
    };
    return reply.code(statusCode).send({
      error: clientErrors[statusCode] ?? {
        code: 'BAD_REQUEST',
        message: 'The request is invalid.',
      },
    });
  });

  server.setNotFoundHandler((_request, reply) =>
    reply
      .code(404)
      .send({ error: { code: 'NOT_FOUND', message: 'This resource does not exist.' } }),
  );

  server.get('/health', async () => ({ status: 'ok' }));

  server.get('/ready', async (_request, reply) => {
    if (options.isReady && !options.isReady()) {
      return reply.code(503).send({ status: 'not_ready' });
    }
    try {
      database.prepare('SELECT 1 AS ready').get();
      return { status: 'ready' };
    } catch {
      return reply.code(503).send({ status: 'not_ready' });
    }
  });

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
        passwordHash: await hashPassword(parsed.data.password),
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
        // Attribution happens inside the same transaction as the account, so a
        // referral can never be recorded for an account that failed to register.
        const referral = readReferralToken(request);
        if (referral) recordReferralAttribution(database, referral, user.id, now);
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
      // Fastify replaces a header unless set-cookie is given an array, so the consumed
      // referral rides along with the session cookie when there is one. With no
      // referral the header stays a single string, exactly as before.
      const referral = readReferralToken(request);
      reply.header(
        'set-cookie',
        referral
          ? [sessionCookie(token, secureCookies), clearedReferralCookie(secureCookies)]
          : sessionCookie(token, secureCookies),
      );
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
      const valid = (await verifyLogin(candidate, user?.passwordHash)) && candidate === password;
      if (!user || !valid) {
        return reply
          .code(401)
          .send({ error: { code: 'INVALID_LOGIN', message: 'Username or password is invalid.' } });
      }
      const now = new Date().toISOString();
      // Transparently upgrade hashes created with older, weaker parameters.
      if (needsRehash(user.passwordHash)) {
        updatePasswordHash(database, user.id, await hashPassword(candidate), now);
      }
      const token = createSession(database, user.id, now);
      // An existing learner who arrived through a share is attributed at sign-in, so a
      // referral is not lost when the recipient already has an account. The
      // consumed cookie rides along with the session cookie; with no referral the
      // header stays a single string, as before.
      const referral = readReferralToken(request);
      if (referral) recordReferralAttribution(database, referral, user.id, now);
      reply.header(
        'set-cookie',
        referral
          ? [sessionCookie(token, secureCookies), clearedReferralCookie(secureCookies)]
          : sessionCookie(token, secureCookies),
      );
      return reply.send({ user: safeUser(user) });
    },
  );

  // Startup check for the web app: always 200, with `user: null` when nobody is signed in, so a
  // signed-out visit does not produce a failed request. `/auth/me` keeps answering 401.
  // Tells the client which of the three identities is active. A real session
  // always wins over a guest cookie, so signing in is never shadowed by guest mode.
  server.get('/api/v1/auth/session', { config: { access: 'public' } }, async (request, reply) =>
    reply.send({
      user: request.user ? safeUser(request.user) : null,
      guest: currentActor(request).type === 'guest',
    }),
  );

  // Starts a guest session. Nothing is written: the response is a signed cookie
  // and no database record of any kind is created.
  server.post('/api/v1/auth/guest', { config: { access: 'public' } }, async (_request, reply) => {
    const guestId = createGuestId();
    const token = signGuestToken(config.guestSessionSecret, guestId, Date.now());
    reply.header('set-cookie', guestCookie(token, secureCookies));
    return reply.code(201).send({ guest: { id: guestId } });
  });

  // Ends a guest session and discards its temporary state.
  server.delete('/api/v1/auth/guest', { config: { access: 'public' } }, async (request, reply) => {
    const actor = currentActor(request);
    if (actor.type === 'guest') guestStore.forgetGuest(actor.guestId);
    reply.header('set-cookie', clearedGuestCookie(secureCookies));
    return reply.code(204).send();
  });

  server.get('/api/v1/auth/me', async (request, reply) => {
    const user = currentUser(request);
    return reply.send({ user: safeUser(user) });
  });

  server.post<{ Body: { content?: unknown; sourceName?: unknown } }>(
    '/api/v1/admin/vocabulary/preview',
    { config: { access: 'administrator' }, bodyLimit: importBodyLimit },
    async (request, reply) => {
      const { content, sourceName } = request.body ?? {};
      if (!isValidSourceName(sourceName)) return rejectSourceName(reply);
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
    { config: { access: 'administrator' }, bodyLimit: importBodyLimit },
    async (request, reply) => {
      const user = currentUser(request);
      const { content, sourceName, confirm } = request.body ?? {};
      if (!isValidSourceName(sourceName)) return rejectSourceName(reply);
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
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const preferences = readPreferences(request);
      const { practiceSessionId } = request.query;
      const practiceSession = practiceSessionId
        ? isGuest(request)
          ? guestStore.getPracticeSession(id, practiceSessionId)
          : getPracticeSession(db, id, practiceSessionId)
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
        isGuest(request)
          ? guestStore.getSelectionCandidates(id, practiceSession?.id ?? null, vocabulary)
          : getSelectionCandidates(db, id, practiceSession?.id ?? null),
        {
          repetitionPreference: preferences.repetitionPreference,
          previousEntryId: practiceSession
            ? isGuest(request)
              ? guestStore.getLastAttemptedEntryInSession(id, practiceSession.id)
              : getLastAttemptedEntryInSession(db, practiceSession.id)
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
      retry?: unknown;
    };
  }>('/api/v1/practice/answer', { config: { access: 'guest' } }, async (request, reply) => {
    const id = actorId(request);
    // `prompt` is accepted for compatibility but ignored: the stored prompt is derived on the
    // server, so a client cannot write arbitrary text into the attempt history.
    const { vocabularyEntryId, direction, submittedAnswer, practiceSessionId, retry } =
      request.body ?? {};
    if (
      typeof vocabularyEntryId !== 'string' ||
      vocabularyEntryId.length > 64 ||
      (direction !== 'english-to-german' && direction !== 'german-to-english') ||
      typeof submittedAnswer !== 'string' ||
      (practiceSessionId !== undefined &&
        (typeof practiceSessionId !== 'string' || practiceSessionId.length > 64)) ||
      (retry !== undefined && typeof retry !== 'boolean')
    ) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ANSWER', message: 'Answer submission is invalid.' } });
    }
    if (submittedAnswer.length > maxSubmittedAnswerLength) {
      return reply
        .code(400)
        .send({ error: { code: 'ANSWER_TOO_LONG', message: 'The answer is too long.' } });
    }
    const practiceSession =
      typeof practiceSessionId === 'string'
        ? isGuest(request)
          ? guestStore.getPracticeSession(id, practiceSessionId)
          : getPracticeSession(db, id, practiceSessionId)
        : undefined;
    if (typeof practiceSessionId === 'string') {
      if (!practiceSession) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      // A retry does not take a question slot, so it stays possible after the last question.
      if (
        practiceSession.status !== 'active' ||
        (!retry && practiceSession.answeredCount >= practiceSession.questionCount)
      ) {
        return reply.code(409).send({
          error: { code: 'SESSION_NOT_ACTIVE', message: 'Practice session is no longer active.' },
        });
      }
    }
    const entry = vocabulary().find((candidate) => candidate.id === vocabularyEntryId);
    if (!entry) {
      return reply.code(404).send({
        error: { code: 'QUESTION_NOT_FOUND', message: 'Question is no longer available.' },
      });
    }
    const acceptedAnswers = direction === 'english-to-german' ? entry.answers : [entry.english];
    const match = matchAnswer(submittedAnswer, acceptedAnswers);
    const correctAnswer = direction === 'english-to-german' ? entry.germanDisplay : entry.english;
    // A retry after a miss is a recall exercise: it is checked with the same matching policy but
    // not recorded, so it earns no points and does not count towards the session or its accuracy.
    if (retry) {
      return reply.send({
        result: {
          correct: match.correct,
          scoreDelta: 0,
          matchingReason: match.reason,
          correctAnswer,
        },
        ...(practiceSession
          ? {
              session: {
                id: practiceSession.id,
                answeredCount: practiceSession.answeredCount,
                questionCount: practiceSession.questionCount,
              },
            }
          : {}),
      });
    }
    const priorErrors = practiceSession
      ? isGuest(request)
        ? guestStore.countIncorrectAttemptsInSession(id, practiceSession.id, entry.id)
        : countIncorrectAttemptsInSession(db, practiceSession.id, entry.id)
      : 0;
    const scoreDelta = calculateScore(match.correct, priorErrors);
    const attemptId = createId();
    // `direction` is narrowed to a concrete direction by the validation above.
    const attempt: Omit<GuestAttempt, 'id'> & { id: string } = {
      id: attemptId,
      vocabularyEntryId: entry.id,
      direction,
      prompt: direction === 'english-to-german' ? entry.english : entry.germanDisplay,
      submittedAnswer,
      normalizedAnswer: match.normalizedAnswer,
      correct: match.correct,
      scoreDelta,
      matchingReason: match.reason,
      attemptedAt: new Date().toISOString(),
      practiceSessionId: practiceSession?.id ?? null,
    };
    if (isGuest(request)) {
      // Memory only. There is no branch here that could reach learning_attempts.
      guestStore.recordAttempt(id, attempt);
    } else {
      recordAttempt(db, { ...attempt, userId: id });
      // A referred learner's first recorded answer is the conversion event. No
      // session is required: answering on the Dashboard counts as starting.
      markReferralConverted(db, id, new Date().toISOString());
    }
    // A user's answeredCount is derived from learning_attempts by the query, so only the
    // guest's in-memory counter needs advancing.
    if (practiceSession && isGuest(request)) {
      guestStore.bumpAnsweredCount(id, practiceSession.id);
    }
    return reply.send({
      result: {
        attemptId,
        correct: match.correct,
        scoreDelta,
        matchingReason: match.reason,
        correctAnswer,
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
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const preferences = readPreferences(request);
      const direction = practiceDirectionSchema.safeParse(
        request.body?.direction ?? preferences.direction,
      );
      if (!direction.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_DIRECTION', message: 'Practice direction is invalid.' },
        });
      }
      // Two distinct refusals: there is no vocabulary at all, or the user has
      // switched every entry off in Settings. Both stop a broken round, and the
      // codes let the screen say which one happened.
      if (vocabulary().length === 0) {
        return reply
          .code(404)
          .send({ error: { code: 'NO_VOCABULARY', message: 'No vocabulary is available.' } });
      }
      if (countPracticeVocabularyFor(request) === 0) {
        return reply.code(404).send({
          error: {
            code: 'NO_PRACTICE_VOCABULARY',
            message: 'No vocabulary is currently selected for practice.',
          },
        });
      }
      const now = new Date().toISOString();
      const sessionInput = {
        id: createId(),
        direction: direction.data,
        questionCount: preferences.sessionLength,
      };
      // A guest round is held in memory; only a user creates a practice_sessions row.
      const session = isGuest(request)
        ? guestStore.startPracticeSession(id, sessionInput, now)
        : startPracticeSession(db, { ...sessionInput, userId: id }, now);
      return reply.code(201).send({ session: publicSession(session) });
    },
  );

  server.get<{ Params: { sessionId: string } }>(
    '/api/v1/practice/sessions/:sessionId',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const summary = isGuest(request)
        ? guestStore.getPracticeSessionSummary(id, request.params.sessionId, vocabulary)
        : getPracticeSessionSummary(db, id, request.params.sessionId);
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
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const session = isGuest(request)
        ? guestStore.getPracticeSession(id, request.params.sessionId)
        : getPracticeSession(db, id, request.params.sessionId);
      if (!session) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      const now = new Date().toISOString();
      if (session.status === 'active') {
        if (isGuest(request)) guestStore.endPracticeSession(id, session, now);
        else endPracticeSession(db, session, now);
      }
      const summary = isGuest(request)
        ? guestStore.getPracticeSessionSummary(id, session.id, vocabulary)
        : getPracticeSessionSummary(db, id, session.id);
      return reply.send({ session: summary ? publicSession(summary) : null });
    },
  );

  // --- Practice vocabulary selection -----------------------------------------
  // Guest-capable: a guest manages their own selection through the same
  // endpoints, held in memory rather than the database.

  server.get(
    '/api/v1/practice/vocabulary',
    { config: { access: 'guest' } },
    async (request, reply) => reply.send({ entries: readPracticeVocabulary(request) }),
  );

  // One request replaces the whole disabled set, so editing the list never
  // costs a request per checkbox.
  server.put<{ Body: unknown }>(
    '/api/v1/practice/vocabulary',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const parsed = practiceVocabularyExclusionsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_VOCABULARY_SELECTION', message: 'The selection is invalid.' },
        });
      }
      const actor = currentActor(request);
      try {
        const entries =
          actor.type === 'guest'
            ? guestStore.setPracticeVocabularyExclusions(
                actor.guestId,
                vocabulary,
                parsed.data.disabledIds,
              )
            : actor.type === 'authenticated'
              ? setPracticeVocabularyExclusions(
                  db,
                  actor.user.id,
                  parsed.data.disabledIds,
                  new Date().toISOString(),
                )
              : [];
        return reply.send({ entries });
      } catch (error) {
        if (error instanceof RepositoryError && error.code === 'invalid') {
          return reply.code(400).send({
            error: {
              code: 'UNKNOWN_VOCABULARY_ENTRY',
              message: 'One or more vocabulary entries do not exist.',
              details: { unknownIds: error.unknownIds },
            },
          });
        }
        throw error;
      }
    },
  );

  // --- Exam Mode ---------------------------------------------------------------
  // An exam is a practice session with kind = 'exam': same answer matching, same
  // lifecycle. Two things differ from a practice round, and both are enforced
  // here rather than in the client.
  //
  //   1. The questions are drawn and stored once, at the start. Practice Mode
  //      re-draws on every request against the live selection; an exam may not,
  //      or the pool could change mid-exam and the same word could repeat.
  //   2. Nothing says whether an answer was correct until the exam ends. The
  //      answer endpoint reports position only, so the client holds no
  //      correctness at any point during the exam and cannot leak one it does
  //      not have — in the DOM, in a label, or in the network response.

  server.post<{ Body: { direction?: unknown; questionCount?: unknown } | undefined }>(
    '/api/v1/exams',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const preferences = readPreferences(request);
      const direction = practiceDirectionSchema.safeParse(
        request.body?.direction ?? preferences.direction,
      );
      if (!direction.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_DIRECTION', message: 'Practice direction is invalid.' },
        });
      }
      // The exam length is the exam's own setting, not the Practice "questions
      // per session" preference, and only the offered lengths are accepted.
      const questionCount = examLengthSchema.safeParse(
        request.body?.questionCount ?? defaultExamLength,
      );
      if (!questionCount.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_EXAM_LENGTH', message: 'Exam length is invalid.' },
        });
      }
      // The same eligible pool as Practice Mode, so the vocabulary selection in
      // Settings governs exams too.
      const candidates = getSelectionCandidatesFor(request, null);
      if (candidates.length === 0) {
        return reply.code(404).send({
          error: {
            code: 'NO_PRACTICE_VOCABULARY',
            message: 'No vocabulary is currently selected for practice.',
          },
        });
      }
      const now = new Date().toISOString();
      const id = createId();
      const input = {
        id,
        direction: direction.data,
        // Provisional: the real length is the size of the drawn set, which is
        // capped by the pool and corrected below where the questions are stored.
        questionCount: questionCount.data,
        kind: 'exam' as const,
      };
      const actor = currentActor(request);
      // Checked explicitly so the actor is narrowed to the two real cases below,
      // rather than inferred from the session that has not been made yet.
      if (actor.type === 'anonymous') {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
      }
      if (actor.type === 'guest') guestStore.startPracticeSession(actor.guestId, input, now);
      else startPracticeSession(db, { ...input, userId: actor.user.id }, now);
      const options = {
        questionCount: questionCount.data,
        direction: direction.data,
        repetitionPreference: preferences.repetitionPreference,
      };
      // Draw once. This set is the exam, fixed for its whole life. The actor is
      // one of the two by now: an anonymous request already failed the 401 above.
      const questions =
        actor.type === 'authenticated'
          ? createExamQuestionSet(db, actor.user.id, id, candidates, options, random)
          : guestStore.createExamQuestionSet(actor.guestId, id, candidates, options, random);
      // `questionCount` is the real number of questions, so the start screen can
      // promise it before the first question is shown.
      return reply.code(201).send({
        session: { id, direction: direction.data, questionCount: questions.length },
      });
    },
  );

  /**
  /**
   * The exam's next question, read from the frozen set.
   *
   * Position is always `answeredCount + 1`, so the order can be neither skipped
   * nor replayed. The response carries the prompt and nothing that says how the
   * learner is doing.
   */
  server.get<{ Params: { sessionId: string } }>(
    '/api/v1/exams/:sessionId/question',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const session = isGuest(request)
        ? guestStore.getPracticeSession(id, request.params.sessionId)
        : getPracticeSession(db, id, request.params.sessionId);
      if (!session) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      if (session.status !== 'active') {
        return reply.code(409).send({
          error: { code: 'SESSION_NOT_ACTIVE', message: 'Practice session is no longer active.' },
        });
      }
      const question = isGuest(request)
        ? guestStore.getExamQuestionAt(id, request.params.sessionId, session.answeredCount + 1)
        : getExamQuestionAt(db, request.params.sessionId, session.answeredCount + 1);
      const entry = question
        ? vocabulary().find((candidate) => candidate.id === question.vocabularyEntryId)
        : undefined;
      if (!question || !entry) {
        return reply.code(404).send({
          error: { code: 'QUESTION_NOT_FOUND', message: 'Exam question was not found.' },
        });
      }
      return reply.send({
        question: {
          position: question.position,
          direction: question.direction,
          prompt: question.direction === 'english-to-german' ? entry.english : entry.germanDisplay,
          phonetics: entry.phonetics,
        },
      });
    },
  );

  /**
   * Records an answer and says nothing about whether it was right.
   *
   * The client sends a position, not a vocabulary entry, so the server resolves
   * which question was actually asked: a client cannot score an entry the exam
   * never used, cannot skip ahead, and cannot replay an earlier position.
   * Correctness is matched and stored here for the final evaluation, and is
   * deliberately absent from the response.
   */
  server.post<{
    Body: { position?: unknown; submittedAnswer?: unknown };
    Params: { sessionId: string };
  }>('/api/v1/exams/:sessionId/answer', { config: { access: 'guest' } }, async (request, reply) => {
    const id = actorId(request);
    const session = isGuest(request)
      ? guestStore.getPracticeSession(id, request.params.sessionId)
      : getPracticeSession(db, id, request.params.sessionId);
    if (!session) {
      return reply.code(404).send({
        error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
      });
    }
    if (session.status !== 'active' || session.answeredCount >= session.questionCount) {
      // Refusing once the exam is full also prevents duplicate submissions from
      // inflating the score.
      return reply.code(409).send({
        error: { code: 'SESSION_NOT_ACTIVE', message: 'Practice session is no longer active.' },
      });
    }
    const { position, submittedAnswer } = request.body ?? {};
    if (
      typeof position !== 'number' ||
      !Number.isInteger(position) ||
      // The position must be the one being asked, not any position at all.
      position !== session.answeredCount + 1 ||
      typeof submittedAnswer !== 'string' ||
      submittedAnswer.length > maxSubmittedAnswerLength
    ) {
      return reply
        .code(400)
        .send({ error: { code: 'INVALID_ANSWER', message: 'Answer submission is invalid.' } });
    }
    const question = isGuest(request)
      ? guestStore.getExamQuestionAt(id, request.params.sessionId, position)
      : getExamQuestionAt(db, request.params.sessionId, position);
    const entry = question
      ? vocabulary().find((candidate) => candidate.id === question.vocabularyEntryId)
      : undefined;
    if (!question || !entry) {
      return reply.code(404).send({
        error: { code: 'QUESTION_NOT_FOUND', message: 'Question is no longer available.' },
      });
    }
    const direction = question.direction;
    const accepted = direction === 'english-to-german' ? entry.answers : [entry.english];
    // The same matching policy as Practice Mode, so correctness is judged the
    // same way in both modes.
    const match = matchAnswer(submittedAnswer, accepted);
    const attempt: Omit<GuestAttempt, 'id'> & { id: string } = {
      id: createId(),
      vocabularyEntryId: entry.id,
      direction,
      prompt: direction === 'english-to-german' ? entry.english : entry.germanDisplay,
      submittedAnswer,
      normalizedAnswer: match.normalizedAnswer,
      // Kept for the final evaluation. It leaves the server only through the
      // result endpoint, which refuses to answer while the exam is running.
      correct: match.correct,
      // An exam awards a pass/fail per question, so it does not use the practice
      // points; the aggregate percentage is computed at the end instead.
      scoreDelta: 0,
      matchingReason: match.reason,
      attemptedAt: new Date().toISOString(),
      practiceSessionId: session.id,
    };
    if (isGuest(request)) {
      guestStore.recordAttempt(id, attempt);
      guestStore.bumpAnsweredCount(id, session.id);
    } else {
      recordAttempt(db, { ...attempt, userId: id });
    }
    const answeredCount = session.answeredCount + 1;
    const complete = answeredCount >= session.questionCount;
    // The exam finishes on its last answer, on the server. Waiting for the
    // client to ask for the result would leave a finished exam stuck in
    // 'active', where no statistic can see it and nothing can recover it.
    if (complete) {
      const now = new Date().toISOString();
      // The session was read before this answer was recorded, so it is passed on
      // with the new count: the status is decided by what was answered, not by
      // what had been answered a moment ago.
      const finished = { ...session, answeredCount };
      if (isGuest(request)) guestStore.endPracticeSession(id, finished, now);
      else endPracticeSession(db, finished, now);
    }
    // Position and progress only: no correctness, no answer, no score.
    return reply.send({
      session: { answeredCount, questionCount: session.questionCount, complete },
    });
  });

  server.post<{ Params: { sessionId: string } }>(
    '/api/v1/exams/:sessionId/end',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const session = isGuest(request)
        ? guestStore.getPracticeSession(id, request.params.sessionId)
        : getPracticeSession(db, id, request.params.sessionId);
      if (!session) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      const now = new Date().toISOString();
      if (session.status === 'active') {
        if (isGuest(request)) guestStore.endPracticeSession(id, session, now);
        else endPracticeSession(db, session, now);
      }
      const result = isGuest(request)
        ? guestStore.getExamResult(id, session.id, vocabulary)
        : getExamResult(db, id, session.id);
      return reply.send({ result: result ?? null });
    },
  );

  /**
   * Records that the learner left before finishing.
   *
   * Leaving is not a failed exam: it is never scored, never counted, and never
   * averaged. Saying so explicitly is what keeps it out of the statistics,
   * rather than relying on a row that happens to still be 'active'.
   */
  server.post<{ Params: { sessionId: string } }>(
    '/api/v1/exams/:sessionId/abandon',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const session = isGuest(request)
        ? guestStore.getPracticeSession(id, request.params.sessionId)
        : getPracticeSession(db, id, request.params.sessionId);
      if (!session) {
        return reply.code(404).send({
          error: { code: 'SESSION_NOT_FOUND', message: 'Practice session was not found.' },
        });
      }
      if (session.status === 'active') {
        const now = new Date().toISOString();
        // Ends as 'abandoned' whenever questions remain, and is a no-op on a
        // session the server already completed.
        if (isGuest(request)) guestStore.endPracticeSession(id, session, now);
        else endPracticeSession(db, session, now);
      }
      return reply.send({ abandoned: true });
    },
  );

  /** The result and its review. Refused while the exam is still running. */
  server.get<{ Params: { sessionId: string } }>(
    '/api/v1/exams/:sessionId',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const result = isGuest(request)
        ? guestStore.getExamResult(id, request.params.sessionId, vocabulary)
        : getExamResult(db, id, request.params.sessionId);
      if (!result) {
        // Either it does not exist, it belongs to someone else, or it is still
        // active. All three are refused the same way, so this endpoint cannot be
        // used to probe for a running exam.
        return reply.code(404).send({
          error: { code: 'EXAM_NOT_FOUND', message: 'Exam result was not found.' },
        });
      }
      return reply.send({ result });
    },
  );

  server.get('/api/v1/exams', { config: { access: 'guest' } }, async (request, reply) => {
    const id = actorId(request);
    const history = isGuest(request)
      ? guestStore.getExamHistory(id, examHistoryLimit)
      : getExamHistory(db, id, examHistoryLimit);
    return reply.send({ history });
  });

  /** Aggregates, computed server-side so Progress never downloads the history. */
  server.get(
    '/api/v1/exams/statistics',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const id = actorId(request);
      const statistics = isGuest(request)
        ? guestStore.getExamStatistics(id, examTrendLimit)
        : getExamStatistics(db, id, examTrendLimit);
      return reply.send({ statistics });
    },
  );

  // --- Share results ---------------------------------------------------------
  //
  // A share is created from a persisted session, never from client-supplied
  // numbers: `readShareableResult` recomputes the score from the recorded
  // attempts every time the card is read, and `createShareResultSchema` is
  // `.strict()` so a body that also carries a score is refused outright.
  //
  // Guests are refused here (`access: 'user'`): a guest has no durable identity,
  // so a share attributed to one would outlive the session that made it.

  /** The public payload for a share, or undefined when it cannot be served. */
  function resolveSharePayload(share: {
    sessionId: string;
    kind: 'practice' | 'exam';
    direction: 'english-to-german' | 'german-to-english' | 'random';
    status: string;
    correctCount: number;
    totalQuestions: number;
  }): ShareResultPayload | undefined {
    // Revoked, still running, abandoned, or backed by no recorded answer: all four
    // collapse to one generic "not available" response, never a specific reason.
    if (!isShareableStatus(share.status)) return undefined;
    if (!hasScorableResult(share.correctCount, share.totalQuestions)) return undefined;
    return buildSharePayload({
      kind: share.kind,
      direction: share.direction,
      correctCount: share.correctCount,
      totalQuestions: share.totalQuestions,
      sharedAt: new Date().toISOString(),
    });
  }

  server.post<{ Body: unknown }>(
    '/api/v1/share/results',
    { config: { access: 'user' } },
    async (request, reply) => {
      if (rejectIfRateLimited(request, reply)) return reply;
      const parsed = createShareResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: { code: 'INVALID_SHARE_REQUEST', message: 'Only a session id may be shared.' },
        });
      }
      const user = currentUser(request);
      const result = readShareableResult(db, user.id, parsed.data.sessionId);
      const payload = result ? resolveSharePayload(result) : undefined;
      // One generic failure for "not yours", "still running", "already abandoned",
      // and "nothing recorded". Distinguishing them would let a caller probe
      // which session ids exist and whose they are.
      if (!result || !payload) {
        return reply
          .code(404)
          .send({ error: { code: 'NOT_SHAREABLE', message: 'That result cannot be shared.' } });
      }
      const share = createOrGetSharedResult(
        db,
        user.id,
        result.sessionId,
        createShareToken(),
        new Date().toISOString(),
      );
      return reply.code(201).send({
        share: {
          id: share.id,
          token: share.token,
          path: sharePath(share.token),
          revoked: share.revokedAt !== null,
          createdAt: share.createdAt,
          // The sanitized card fields, not the stored session row.
          ...payload,
        },
      });
    },
  );

  /** The owner's own shares. There is deliberately no route that lists others'. */
  server.get('/api/v1/share/results', { config: { access: 'user' } }, async (request, reply) => {
    const user = currentUser(request);
    const shares = listSharedResults(db, user.id).map((share) => {
      const result = readShareableResult(db, user.id, share.sessionId);
      const payload = result ? resolveSharePayload(result) : undefined;
      return {
        id: share.id,
        token: share.token,
        path: sharePath(share.token),
        revoked: share.revokedAt !== null,
        createdAt: share.createdAt,
        ...getShareReferralStats(db, user.id, share.id),
        // A revoked share, or one whose session has since been removed, reports the
        // minimum rather than a card that no longer resolves publicly.
        ...(payload ?? {
          kind: 'practice',
          direction: 'random',
          correctCount: 0,
          totalQuestions: 0,
          score: 0,
          sharedAt: share.createdAt,
        }),
      };
    });
    return reply.send({ shares });
  });

  server.delete<{ Params: { id: string } }>(
    '/api/v1/share/results/:id',
    { config: { access: 'user' } },
    async (request, reply) => {
      const user = currentUser(request);
      if (revokeSharedResult(db, user.id, request.params.id, new Date().toISOString())) {
        return reply.send({ revoked: true });
      }
      // Not revoked: either it does not exist or it belongs to somebody else. The
      // two are indistinguishable on purpose.
      return reply
        .code(404)
        .send({ error: { code: 'NOT_FOUND', message: 'That share does not exist.' } });
    },
  );

  /**
   * The public card. Anonymous by design: this is the one route that must work
   * for somebody who has never signed in.
   *
   * It returns only the allow-listed scalars in `shareResultPayloadSchema` -- never
   * the owner, a username, or a per-word answer. Unknown, malformed, revoked, and
   * orphaned tokens all produce the same single response, so the endpoint cannot be
   * used to test whether a token ever existed. Rate limited because the token is
   * all that stands between a stranger and a database lookup.
   */
  server.get<{ Params: { token: string } }>(
    '/api/v1/share/card/:token',
    { config: { access: 'public' } },
    async (request, reply) => {
      if (rejectIfRateLimited(request, reply)) return reply;
      const unavailable = () =>
        reply.code(404).send({
          error: { code: 'SHARE_NOT_FOUND', message: 'This shared result is not available.' },
        });
      const token = request.params.token;
      if (!isShareToken(token)) return unavailable();
      const share = getSharedResultByToken(db, token);
      if (!share || share.revokedAt !== null) return unavailable();
      const result = readShareableResult(db, share.userId, share.sessionId);
      const payload = result ? resolveSharePayload(result) : undefined;
      if (!payload) return unavailable();
      // Remember the referral so a later registration or login is attributed to
      // this share. Opening the card still never reveals the sharer.
      reply.header('set-cookie', referralCookie(token, secureCookies));
      return reply.send({ result: payload });
    },
  );

  server.get('/api/v1/dashboard', { config: { access: 'guest' } }, async (request, reply) => {
    const id = actorId(request);
    return reply.send({
      dashboard: isGuest(request)
        ? guestStore.getDashboardSummary(id, vocabulary)
        : getDashboardSummary(db, id),
    });
  });

  server.get('/api/v1/settings', { config: { access: 'guest' } }, async (request, reply) => {
    return reply.send({ settings: readPreferences(request) });
  });

  server.put<{ Body: unknown }>(
    '/api/v1/settings',
    { config: { access: 'guest' } },
    async (request, reply) => {
      const parsed = userPreferencesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_SETTINGS', message: 'Practice settings are invalid.' } });
      }
      return reply.send({ settings: writePreferences(request, parsed.data) });
    },
  );

  server.post('/api/v1/auth/logout', { config: { access: 'public' } }, async (request, reply) => {
    const token = readSessionToken(request);
    if (token) {
      revokeSession(database, token, new Date().toISOString());
    }
    // Leaving a session also ends guest mode and discards the guest's temporary
    // state, so a shared device does not hand the next person a guest session.
    const actor = currentActor(request);
    if (actor.type === 'guest') guestStore.forgetGuest(actor.guestId);
    reply.header('set-cookie', [
      clearedSessionCookie(secureCookies),
      clearedGuestCookie(secureCookies),
    ]);
    return reply.code(204).send();
  });

  return server;
}
