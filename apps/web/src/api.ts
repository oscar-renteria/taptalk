import { signOut } from './session';

let onSessionExpired: () => void = () => undefined;

export function setSessionExpiredHandler(handler: () => void): void {
  onSessionExpired = handler;
}

// fetch() for authenticated API calls. A 401 means the session expired or was revoked
// elsewhere: the user is signed out and sent to the login screen.
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(input, init);
  if (response.status === 401) {
    signOut();
    onSessionExpired();
  }
  return response;
}

export function jsonRequest(method: 'POST' | 'PUT', body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
