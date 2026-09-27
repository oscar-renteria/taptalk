import { reactive } from 'vue';
import type { User } from './types';

// Who the app is acting as. The server decides this from the HttpOnly cookies; the
// client never decides it for itself, it only reflects what the server reported.
export type ActorKind = 'anonymous' | 'guest' | 'authenticated';

// The signed-in user, shared by the router guard and the views. The session itself lives in an
// HttpOnly cookie; nothing authentication-related is stored in the browser (ADR-005).
export const session = reactive({
  user: null as User | null,
  // True when the server reports an active guest session. Never true at the same
  // time as `user`: a real session always wins, so signing in ends guest mode.
  guest: false,
  checked: false,
});

export function actorKind(): ActorKind {
  if (session.user) return 'authenticated';
  return session.guest ? 'guest' : 'anonymous';
}

let restoring: Promise<void> | null = null;

export function restoreSession(): Promise<void> {
  if (session.checked) return Promise.resolve();
  restoring ??= (async () => {
    try {
      // Answers 200 with `user: null` when signed out, so a normal visit logs no failed request.
      const response = await fetch('/api/v1/auth/session');
      const payload = (await response.json()) as { user?: User | null; guest?: boolean };
      session.user = response.ok && payload.user ? payload.user : null;
      session.guest = response.ok && !session.user && payload.guest === true;
    } catch {
      session.user = null; // Offline or unavailable: treat as signed out.
      session.guest = false;
    } finally {
      session.checked = true;
      restoring = null;
    }
  })();
  return restoring;
}

export function signIn(user: User): void {
  session.user = user;
  // A real account supersedes guest mode.
  session.guest = false;
  session.checked = true;
}

export function signOut(): void {
  session.user = null;
  session.guest = false;
  session.checked = true;
}

// Test helper: forget the cached session so the next navigation checks again.
export function resetSession(): void {
  session.user = null;
  session.guest = false;
  session.checked = false;
  restoring = null;
}

// Focused mode: the redesign hides the site navigation while a practice session
// is running, so one exercise owns the screen. PracticeView owns this flag and
// the shell reads it to drop the navigation and hero.
export const focus = reactive({ practice: false });
