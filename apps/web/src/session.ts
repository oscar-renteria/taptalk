import { reactive } from 'vue';
import type { User } from './types';

// The signed-in user, shared by the router guard and the views. The session itself lives in an
// HttpOnly cookie; nothing authentication-related is stored in the browser (ADR-005).
export const session = reactive({ user: null as User | null, checked: false });

let restoring: Promise<void> | null = null;

export function restoreSession(): Promise<void> {
  if (session.checked) return Promise.resolve();
  restoring ??= (async () => {
    try {
      // Answers 200 with `user: null` when signed out, so a normal visit logs no failed request.
      const response = await fetch('/api/v1/auth/session');
      const payload = (await response.json()) as { user?: User | null };
      session.user = response.ok && payload.user ? payload.user : null;
    } catch {
      session.user = null; // Offline or unavailable: treat as signed out.
    } finally {
      session.checked = true;
      restoring = null;
    }
  })();
  return restoring;
}

export function signIn(user: User): void {
  session.user = user;
  session.checked = true;
}

export function signOut(): void {
  session.user = null;
  session.checked = true;
}

// Test helper: forget the cached session so the next navigation checks again.
export function resetSession(): void {
  session.user = null;
  session.checked = false;
  restoring = null;
}
