import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { createId, type SqliteDatabase } from './database.js';
import { readGuestToken, verifyGuestToken, type RequestActor } from './guest.js';

// Session strategy: see docs/decisions/ADR-005-authentication-session.md.
export const sessionCookieName = 'taptalk_session';
export const sessionDurationMs = 1000 * 60 * 60 * 24 * 14;

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: 'user' | 'administrator';
  createdAt: string;
};

// Route access level, declared per route as `config: { access }`. Routes under /api default to
// 'user', so a new endpoint is protected unless it explicitly opts out. Routes under /api/v1/admin
// always require 'administrator' and cannot be downgraded by configuration.
/**
 * 'user' requires a database-backed user. 'guest' allows either a real user or a
 * guest session, and is for the practice, dashboard, and settings routes a guest
 * can use without an account. 'administrator' is always a real user and can
 * never be downgraded, so a guest can never reach admin functionality.
 */
export type RouteAccess = 'public' | 'user' | 'guest' | 'administrator';

export type AccessDecision = 'allowed' | 'unauthenticated' | 'forbidden';

const adminRoutePrefix = '/api/v1/admin/';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
    /**
     * Who is acting: a database user, a guest, or nobody. Resolved server-side by
     * the guard. Unset before the guard runs, so read it through currentActor().
     */
    actor?: RequestActor;
  }
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
}

// Password hashing: scrypt with OWASP-recommended parameters (N=2^14, r=8, p=5: ~16 MB memory).
// Parameters are stored with each hash so they can be raised later without breaking old hashes.
// Hashing runs asynchronously in the libuv thread pool, so a login never blocks other requests.
const scryptParameters = { N: 2 ** 14, r: 8, p: 5 } as const;
const keyLength = 64;

function scryptAsync(
  password: string,
  salt: string,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyLength, { ...options, maxmem: 64 * 1024 * 1024 }, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const { N, r, p } = scryptParameters;
  const hash = await scryptAsync(password, salt, scryptParameters);
  return `scrypt$${N}$${r}$${p}$${salt}$${hash.toString('hex')}`;
}

// Accepts the current format and the legacy "salt:hash" format (N=2^14, r=8, p=1).
function parseHash(stored: string) {
  const current = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([0-9a-f]+)\$([0-9a-f]+)$/.exec(stored);
  if (current) {
    const [, N, r, p, salt, hash] = current;
    return { N: Number(N), r: Number(r), p: Number(p), salt: salt!, hash: hash!, legacy: false };
  }
  const [salt, hash] = stored.split(':');
  return salt && hash ? { N: 2 ** 14, r: 8, p: 1, salt, hash, legacy: true } : undefined;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = parseHash(storedHash);
  if (!parsed) {
    return false;
  }
  const actual = await scryptAsync(password, parsed.salt, parsed);
  const expected = Buffer.from(parsed.hash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// True when a stored hash uses weaker parameters than the current ones and should be replaced.
export function needsRehash(storedHash: string): boolean {
  const parsed = parseHash(storedHash);
  const { N, r, p } = scryptParameters;
  return !parsed || parsed.legacy || parsed.N < N || parsed.r < r || parsed.p < p;
}

// Verifying against this hash when a username is unknown keeps login timing independent of
// whether the account exists.
const unknownUserHash = hashPassword(randomBytes(16).toString('hex'));

export async function verifyLogin(
  password: unknown,
  storedHash: string | undefined,
): Promise<boolean> {
  const candidate = typeof password === 'string' ? password : '';
  const matches = await verifyPassword(candidate, storedHash ?? (await unknownUserHash));
  return storedHash !== undefined && typeof password === 'string' && matches;
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function readSessionToken(request: {
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

export function sessionCookie(token: string, secure: boolean): string {
  return `${sessionCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionDurationMs / 1000}${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure: boolean): string {
  return `${sessionCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

// Creates a session and removes expired ones, so the table does not grow without bound.
export function createSession(database: SqliteDatabase, userId: string, now: string): string {
  const token = randomBytes(32).toString('base64url');
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now);
  database
    .prepare(
      'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(
      createId(),
      userId,
      hashSessionToken(token),
      new Date(Date.parse(now) + sessionDurationMs).toISOString(),
      now,
    );
  return token;
}

export function revokeSession(database: SqliteDatabase, token: string, now: string): void {
  database
    .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .run(now, hashSessionToken(token));
}

export function findSessionUser(
  database: SqliteDatabase,
  token: string | undefined,
  now: string,
): AuthenticatedUser | undefined {
  if (!token) return undefined;
  return database
    .prepare(
      `SELECT u.id, u.username, u.role, u.created_at AS createdAt
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .get(hashSessionToken(token), now) as AuthenticatedUser | undefined;
}

export function routeAccess(
  url: string | undefined,
  declared: RouteAccess | undefined,
): RouteAccess {
  if (!url || !url.startsWith('/api/')) return 'public';
  if (url.startsWith(adminRoutePrefix)) return 'administrator';
  return declared ?? 'user';
}

// The single role check for the API. Pure, so the policy is unit-testable without HTTP.
export function authorize(user: AuthenticatedUser | null, access: RouteAccess): AccessDecision {
  if (access === 'public') return 'allowed';
  if (!user) return 'unauthenticated';
  if (access === 'administrator' && user.role !== 'administrator') return 'forbidden';
  return 'allowed';
}

/**
 * The same policy over the full actor. A guest is a first-class identity here:
 * it satisfies 'guest' routes and is refused 'user' and 'administrator' routes, so
 * account-only work (settings on the server, admin) can never run for a guest.
 */
export function authorizeActor(actor: RequestActor, access: RouteAccess): AccessDecision {
  if (access === 'public') return 'allowed';
  if (access === 'guest') {
    return actor.type === 'anonymous' ? 'unauthenticated' : 'allowed';
  }
  return authorize(actor.type === 'authenticated' ? actor.user : null, access);
}

// preHandler hook: resolves the identity once per request and enforces the route's access.
// A real session always wins; a signed guest cookie is only consulted when there
// is no real session, so signing in always takes precedence over guest mode.
export function createAccessGuard(database: SqliteDatabase, guestSecret?: string) {
  return async function accessGuard(request: FastifyRequest, reply: FastifyReply) {
    const now = new Date();
    const user = findSessionUser(database, readSessionToken(request), now.toISOString()) ?? null;
    request.user = user;
    request.actor = user
      ? { type: 'authenticated', user }
      : resolveGuestActor(request, guestSecret, now.getTime());
    const decision = authorizeActor(
      request.actor,
      routeAccess(request.routeOptions.url, request.routeOptions.config.access),
    );
    if (decision === 'unauthenticated') {
      return reply
        .code(401)
        .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
    }
    if (decision === 'forbidden') {
      return reply
        .code(403)
        .send({ error: { code: 'FORBIDDEN', message: 'Administrator access is required.' } });
    }
  };
}

function resolveGuestActor(
  request: FastifyRequest,
  guestSecret: string | undefined,
  nowMs: number,
): RequestActor {
  if (!guestSecret) return { type: 'anonymous' };
  const guestId = verifyGuestToken(guestSecret, readGuestToken(request), nowMs);
  return guestId ? { type: 'guest', guestId } : { type: 'anonymous' };
}

/** The acting identity. The guard has already authorized it. */
export function currentActor(request: FastifyRequest): RequestActor {
  return request.actor ?? { type: 'anonymous' };
}

/**
 * The acting identity, narrowed to a real database user. Use on routes that
 * declare access 'user' or 'administrator', where a guest is never admitted.
 */
export function currentUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw new Error('currentUser() used on a route without authentication.');
  }
  return request.user;
}
