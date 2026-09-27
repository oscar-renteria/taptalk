import { session } from './session';

/**
 * Guest mode on the client.
 *
 * The guest identity is a server-signed HttpOnly cookie, so nothing here can
 * fabricate one. The only local state is a small snapshot of what the guest has
 * done, kept per guest id so two guests on one browser never see each other's
 * data, and used to restore the screens after a refresh or a PWA restart (the
 * server's in-memory copy is empty after an API restart).
 *
 * Nothing in this module is ever sent to the server as anything but a request to
 * the existing guest endpoints, and the snapshot is cleared whenever the guest
 * session ends.
 */

const storageKey = 'taptalk.guest';
const maxSnapshots = 8;

export type GuestSnapshot = {
  guestId: string;
  settings?: unknown;
  dashboard?: unknown;
  summary?: unknown;
  savedAt: string;
};

type GuestCache = Record<string, GuestSnapshot>;

function readCache(): GuestCache {
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as GuestCache) : {};
  } catch {
    // Private mode, disabled storage, or corrupt JSON: guest mode still works,
    // it just cannot restore the last screen.
    return {};
  }
}

function writeCache(cache: GuestCache): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(cache));
  } catch {
    // Best effort only.
  }
}

/** Records the guest's current server state so it can be restored after a reload. */
export function rememberGuestState(guestId: string, patch: Partial<GuestSnapshot>): void {
  if (!guestId) return;
  const cache = readCache();
  const previous = cache[guestId] ?? { guestId, savedAt: new Date().toISOString() };
  cache[guestId] = { ...previous, ...patch, guestId, savedAt: new Date().toISOString() };
  // Keep the store small: this is convenience state, not a backup.
  const keys = Object.keys(cache);
  if (keys.length > maxSnapshots) {
    for (const key of keys.slice(0, keys.length - maxSnapshots)) delete cache[key];
  }
  writeCache(cache);
}

export function recallGuestState(guestId: string): GuestSnapshot | undefined {
  if (!guestId) return undefined;
  return readCache()[guestId];
}

/** Discards everything remembered for one guest. Called when a guest session ends. */
export function forgetGuestState(guestId?: string): void {
  const cache = readCache();
  if (guestId) delete cache[guestId];
  else for (const key of Object.keys(cache)) delete cache[key];
  writeCache(cache);
}

/**
 * Starts a guest session. The server issues the signed cookie and creates
 * nothing in the database; the returned id is only used to key local state.
 */
export async function startGuestSession(): Promise<boolean> {
  const response = await fetch('/api/v1/auth/guest', { method: 'POST' });
  if (!response.ok) return false;
  const payload = (await response.json()) as { guest?: { id?: string } };
  session.guest = true;
  session.user = null;
  session.checked = true;
  if (payload.guest?.id) rememberGuestState(payload.guest.id, {});
  return true;
}

/** Ends the guest session server-side and clears the local snapshot. */
export async function endGuestSession(): Promise<void> {
  await fetch('/api/v1/auth/guest', { method: 'DELETE' }).catch(() => undefined);
  forgetGuestState();
  session.guest = false;
  session.checked = true;
}
