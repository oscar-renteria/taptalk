import crypto from 'node:crypto';
import type { PracticeDirection, ShareResultPayload } from '@taptalk/shared';

/**
 * Share results and referral links. Pure domain rules for the public share card:
 * token shape, what may be shared, and exactly which scalars may leave the
 * owner's session. No database, no HTTP.
 *
 * See docs/architecture/share-and-referral.md.
 */

export type ShareKind = 'practice' | 'exam';

/**
 * 256 bits from the CSPRNG, base64url encoded (43 chars, no padding).
 *
 * The token is the public URL component, not a secret that unlocks anything: the
 * public endpoint serves one anonymized card and nothing else. It is stored as
 * issued so the owner can re-open their own share URL later, which keeps the
 * public URL stable as required by the lifecycle rules.
 *
 * It is deliberately NOT derived from the row id or any counter, so tokens are
 * not enumerable or guessable from the order in which shares were created.
 */
export function createShareToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

/** The exact token shape `createShareToken` produces. Rejects anything else. */
export function isShareToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** The public route for a token. Returned to the owner so the client can build a URL. */
export function sharePath(token: string): string {
  return `/share/${token}`;
}

/**
 * Only a finished result may be shared. An active session has no final score
 * yet, and an abandoned one was left early -- neither is a result worth showing,
 * and both would change as the learner answers more.
 */
export function isShareableStatus(status: string): boolean {
  return status === 'completed';
}

/**
 * A session qualifies only once it has a real score: at least one recorded
 * attempt. Guards against sharing a "completed" session that somehow recorded
 * nothing, which would render as an empty 0/0 card.
 */
export function hasScorableResult(correctCount: number, totalQuestions: number): boolean {
  return totalQuestions > 0 && correctCount >= 0 && correctCount <= totalQuestions;
}

/**
 * Build the sanitized payload. This function is the single place a share card is
 * constructed, so there is no path by which owner identity, per-word answers, or
 * history can reach the public endpoint: the returned object is built field by
 * field from five scalars rather than by spreading a record.
 */
export function buildSharePayload(input: {
  kind: ShareKind;
  direction: PracticeDirection;
  correctCount: number;
  totalQuestions: number;
  sharedAt: string;
}): ShareResultPayload {
  const { kind, direction, correctCount, totalQuestions, sharedAt } = input;
  return {
    kind,
    direction,
    correctCount,
    totalQuestions,
    // The same rounding the exam score uses, so a shared practice card and a
    // shared exam card never disagree about the same ratio.
    score: totalQuestions === 0 ? 0 : Math.round((correctCount / totalQuestions) * 100),
    sharedAt,
  };
}
