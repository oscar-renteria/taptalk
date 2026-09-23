import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { afterEach, vi } from 'vitest';
import { createMemoryHistory } from 'vue-router';
import App from './App.vue';
import { createAppRouter, installSessionExpiry } from './router';
import { resetSession } from './session';

type MockResponse = { status?: number; body?: unknown };

// Stubs `fetch` by "METHOD /path" (query ignored). An array answers consecutive calls in order and
// repeats its last entry. Unknown routes answer 404, so an unexpected call fails visibly.
// Mounted apps share the session store, so each test unmounts its app to avoid cross-talk.
enableAutoUnmount(afterEach);

export function mockApi(routes: Record<string, MockResponse | MockResponse[]>) {
  const calls = new Map<string, number>();
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input.split('?')[0]}`;
    const route = routes[key];
    const index = calls.get(key) ?? 0;
    calls.set(key, index + 1);
    const response = Array.isArray(route) ? route[Math.min(index, route.length - 1)] : route;
    const status = response ? (response.status ?? 200) : 404;
    const body = response ? response.body : { error: { message: `Unmocked ${key}` } };
    return { ok: status < 400, status, json: async () => body };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export function bodyOf(fetchMock: ReturnType<typeof mockApi>, key: string): unknown {
  const call = fetchMock.mock.calls.find(
    ([input, init]) => `${init?.method ?? 'GET'} ${input.split('?')[0]}` === key,
  );
  return call?.[1]?.body ? JSON.parse(String(call[1].body)) : undefined;
}

export const learner = { username: 'learner', role: 'user' };
export const signedIn = { 'GET /api/v1/auth/session': { body: { user: learner } } };
export const signedOut = { 'GET /api/v1/auth/session': { body: { user: null } } };

export const admin = { username: 'admin', role: 'administrator' };
export const signedInAdmin = { 'GET /api/v1/auth/session': { body: { user: admin } } };

// Mounts the whole app with an in-memory router at `path`, after the session check and the
// first navigation (including guard redirects) have completed.
export async function mountApp(path: string) {
  resetSession();
  // Installing the router starts the first navigation from the history location.
  const history = createMemoryHistory();
  history.replace(path);
  const router = createAppRouter(history);
  installSessionExpiry(router);
  const wrapper = mount(App, { global: { plugins: [router] }, attachTo: document.body });
  await router.isReady();
  await flushPromises();
  return { wrapper, router };
}
