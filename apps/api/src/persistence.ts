import { guestIdPrefix, isGuestId } from './guest.js';

/**
 * The persistence boundary. Guest sessions are real identities but must never
 * create or modify durable user data, so every user-scoped repository call
 * asserts the id is a real user id first.
 *
 * This is a backstop, not the primary control: routes resolve an actor and
 * never call a user repository for a guest. It exists so that if a future
 * change ever does route a guest id into a user write, the write fails loudly
 * instead of creating a permanent row for a throwaway identity.
 */
export class GuestPersistenceError extends Error {
  constructor(operation: string) {
    super(`Refusing to persist data for a guest session (${operation}).`);
    this.name = 'GuestPersistenceError';
  }
}

/** Throws when a user id is actually a guest id. */
export function assertPersistableUserId(userId: string, operation: string): void {
  if (isGuestId(userId)) throw new GuestPersistenceError(operation);
}

/** Type guard for code that must not accept a guest at all. */
export function isPersistableUserId(userId: string): boolean {
  return !isGuestId(userId) && !userId.startsWith(guestIdPrefix);
}
