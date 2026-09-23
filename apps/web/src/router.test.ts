// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { safeRedirect } from './router';
import { mockApi, mountApp, signedIn, signedInAdmin, signedOut } from './test-api';

const learner = { username: 'learner', role: 'user' };

describe('route guards', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it.each(['/practice', '/progress', '/settings', '/admin/import'])(
    'sends a signed-out visitor from %s to login with a return path',
    async (path) => {
      mockApi(signedOut);
      const { router } = await mountApp(path);
      expect(router.currentRoute.value.name).toBe('login');
      expect(router.currentRoute.value.query.redirect).toBe(path);
    },
  );

  it('returns to the requested page after logging in', async () => {
    mockApi({
      ...signedOut,
      'POST /api/v1/auth/login': { body: { user: learner } },
      'GET /api/v1/settings': { body: { settings: { direction: 'random', sessionLength: 10 } } },
    });
    const { wrapper, router } = await mountApp('/settings');
    await wrapper.get('#username').setValue('learner');
    await wrapper.get('#password').setValue('a-secure-password');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/settings');
    expect(wrapper.get('h1').text()).toBe('Set your rhythm.');
  });

  it('keeps signed-in users away from login and registration', async () => {
    mockApi(signedIn);
    const { router } = await mountApp('/register');
    expect(router.currentRoute.value.path).toBe('/practice');
  });

  it('redirects a regular user away from the administrator area', async () => {
    mockApi(signedIn);
    const { wrapper, router } = await mountApp('/admin/import');
    expect(router.currentRoute.value.path).toBe('/practice');
    expect(wrapper.text()).not.toContain('Import vocabulary');
  });

  it('lets an administrator open the import area and shows its navigation item', async () => {
    mockApi({
      ...signedInAdmin,
      'GET /api/v1/admin/vocabulary/imports': { body: { imports: [] } },
    });
    const { wrapper, router } = await mountApp('/admin/import');
    expect(router.currentRoute.value.path).toBe('/admin/import');
    expect(wrapper.get('a[aria-current="page"]').text()).toBe('Import vocabulary');
  });

  it('shows a not-found page for unknown paths', async () => {
    mockApi(signedIn);
    const { wrapper } = await mountApp('/does/not/exist');
    expect(wrapper.get('h1').text()).toBe('Page not found.');
    expect(wrapper.get('a.btn').attributes('href')).toBe('/practice');
    expect(document.title).toBe('Page not found · TapTalk');
  });

  it('sends the user to login when the session expires during use', async () => {
    mockApi({ ...signedIn, 'GET /api/v1/dashboard': { status: 401, body: {} } });
    const { router } = await mountApp('/progress');
    await flushPromises();
    expect(router.currentRoute.value.name).toBe('login');
    expect(router.currentRoute.value.query.redirect).toBe('/progress');
  });

  it('shows the loading state until the session check finishes', async () => {
    let finish: ((value: unknown) => void) | undefined;
    vi.stubGlobal(
      'fetch',
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = mountApp('/practice');
    await vi.waitFor(() => expect(finish).toBeDefined());
    expect(document.body.textContent).toContain('Checking your session...');
    finish?.({ ok: false, status: 401, json: async () => ({}) });
    await pending;
    expect(document.body.querySelector('#username')).not.toBeNull();
  });
});

describe('safeRedirect', () => {
  it.each([
    ['/settings', '/settings'],
    ['/progress?x=1', '/progress?x=1'],
    ['//evil.example', '/practice'],
    ['https://evil.example', '/practice'],
    [undefined, '/practice'],
    [['/a'], '/practice'],
  ])('maps %j to %s', (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });
});
