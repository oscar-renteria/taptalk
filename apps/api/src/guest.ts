import type { FastifyRequest } from 'fastify';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { AuthenticatedUser } from './auth.js';

// Guest sessions: see docs/decisions/ADR-006-guest-sessions.md.
//
// A guest is a real, signed identity, but not a database user. There is no row
// in `users`, no row in `sessions`, and no row anywhere else: the cookie carries
// a signed guest id, and the server verifies the signature before trusting it.
// That keeps a single session architecture (one cookie, one guard, one actor
// type) instead of bolting a parallel auth system onto the existing one.
//
// Because nothing is stored, a guest cannot be used to write persistent user
// data, and there is no guest account to attack, delete, or leak.

export const guestCookieName = 'taptalk_guest';
export const guestSessionDurationMs = 1000 * 60 * 60 * 24 * 14;

/** Every guest id carries this prefix so persistence can refuse it (see persistence.ts). */
export const guestIdPrefix = 'guest_';

export type GuestActor = { type: 'guest'; guestId: string };
export type UserActor = { type: 'authenticated'; user: AuthenticatedUser };
export type Actor = UserActor | GuestActor;

/** Who is making the request. Never inferred from a body or query value. */
export type RequestActor = Actor | { type: 'anonymous' };

export function createGuestId(): string {
  return `${guestIdPrefix}${randomBytes(16).toString('hex')}`;
}

export function isGuestId(value: string): boolean {
  return value.startsWith(guestIdPrefix);
}

// Stateless token: `<guestId>.<issuedAtMs>.<hmac>`. The signature covers the id
// and the issue time, so neither can be edited by the client, and the issue time
// bounds the session's lifetime. Verification is what makes the guest trusted;
// a client that sets its own cookie, or sends `isGuest=true` in a body, is
// ignored, because only a valid signature produces an actor.
function signature(secret: string, guestId: string, issuedAt: string): string {
  return createHmac('sha256', secret).update(`${guestId}.${issuedAt}`).digest('base64url');
}

export function signGuestToken(secret: string, guestId: string, issuedAtMs: number): string {
  const issuedAt = String(issuedAtMs);
  return `${guestId}.${issuedAt}.${signature(secret, guestId, issuedAt)}`;
}

export function verifyGuestToken(
  secret: string,
  token: string | undefined,
  nowMs: number,
): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [guestId, issuedAt, provided] = parts as [string, string, string];
  if (!isGuestId(guestId)) return null;
  const expected = signature(secret, guestId, issuedAt);
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const issuedAtMs = Number(issuedAt);
  if (!Number.isSafeInteger(issuedAtMs)) return null;
  // Expired guest sessions are indistinguishable from no session at all.
  if (nowMs - issuedAtMs > guestSessionDurationMs) return null;
  if (issuedAtMs - nowMs > 60_000) return null; // Reject tokens from the future.
  return guestId;
}

export function guestCookie(token: string, secure: boolean): string {
  return `${guestCookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${
    guestSessionDurationMs / 1000
  }${secure ? '; Secure' : ''}`;
}

export function clearedGuestCookie(secure: boolean): string {
  return `${guestCookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;
}

export function readGuestToken(request: FastifyRequest): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === guestCookieName) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }
  return undefined;
}
