import type { FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { createId, type SqliteDatabase } from './database.js';

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
// 'user', so a new endpoint is protected unless it explicitly opts out.
export type RouteAccess = 'public' | 'user';

declare module 'fastify' {
  interface FastifyRequest {
    user: AuthenticatedUser | null;
  }
  interface FastifyContextConfig {
    access?: RouteAccess;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHash] = storedHash.split(':');
  if (!salt || !expectedHash) {
    return false;
  }
  const actualHash = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expectedHash, 'hex');
  return actualHash.length === expectedBuffer.length && timingSafeEqual(actualHash, expectedBuffer);
}

// Verifying against this hash when a username is unknown keeps login timing independent of
// whether the account exists.
const unknownUserHash = hashPassword(randomBytes(16).toString('hex'));

export function verifyLogin(password: unknown, storedHash: string | undefined): boolean {
  const candidate = typeof password === 'string' ? password : '';
  const matches = verifyPassword(candidate, storedHash ?? unknownUserHash);
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

export function routeAccess(request: FastifyRequest): RouteAccess {
  const url = request.routeOptions.url;
  if (!url || !url.startsWith('/api/')) return 'public';
  return request.routeOptions.config.access ?? 'user';
}

// preHandler hook: resolves the session user once per request and enforces the route's access.
export function createAccessGuard(database: SqliteDatabase) {
  return async function accessGuard(request: FastifyRequest, reply: FastifyReply) {
    request.user =
      findSessionUser(database, readSessionToken(request), new Date().toISOString()) ?? null;
    if (routeAccess(request) === 'public' || request.user) return;
    return reply
      .code(401)
      .send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication is required.' } });
  };
}

// Handlers behind the guard use this instead of re-checking the session.
export function currentUser(request: FastifyRequest): AuthenticatedUser {
  if (!request.user) {
    throw new Error('currentUser() used on a route without authentication.');
  }
  return request.user;
}
