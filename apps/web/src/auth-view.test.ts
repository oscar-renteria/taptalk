// @vitest-environment happy-dom

import { flushPromises, type VueWrapper } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, mountApp, signedOut } from './test-api';

const learner = { username: 'learner', role: 'user' };

async function fill(wrapper: VueWrapper, username: string, password: string) {
  await wrapper.get('#username').setValue(username);
  await wrapper.get('#password').setValue(password);
}

function authCalls(fetchMock: ReturnType<typeof mockApi>) {
  return fetchMock.mock.calls.filter(
    ([url]) => String(url).startsWith('/api/v1/auth/l') || String(url).startsWith('/api/v1/auth/r'),
  );
}

describe('registration screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('validates on the client with the shared policy before sending anything', async () => {
    const fetchMock = mockApi(signedOut);
    const { wrapper } = await mountApp('/register');
    await fill(wrapper, 'learner', 'password');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(authCalls(fetchMock)).toHaveLength(0);
    const input = wrapper.get('#password');
    expect(input.attributes('aria-invalid')).toBe('true');
    expect(wrapper.get('#password-error').text()).toContain('too common');
    expect(input.attributes('aria-describedby')).toContain('password-error');
    expect(document.activeElement?.id).toBe('password');
  });

  it('shows field errors only after the first submit and clears them as the user fixes them', async () => {
    mockApi(signedOut);
    const { wrapper } = await mountApp('/register');
    await fill(wrapper, 'x', 'a-secure-password');
    expect(wrapper.find('#username-error').exists()).toBe(false);

    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('#username-error').text()).toContain('at least 2');
    await wrapper.get('#username').setValue('learner');
    expect(wrapper.find('#username-error').exists()).toBe(false);
  });

  it('maps server field errors and taken usernames to the matching field', async () => {
    mockApi({
      ...signedOut,
      'POST /api/v1/auth/register': [
        {
          status: 400,
          body: {
            error: {
              code: 'INVALID_REGISTRATION',
              details: [{ field: 'password', message: 'Server says no.' }],
            },
          },
        },
        { status: 409, body: { error: { code: 'USERNAME_UNAVAILABLE' } } },
      ],
    });
    const { wrapper } = await mountApp('/register');
    await fill(wrapper, 'learner', 'a-secure-password');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('#password-error').text()).toBe('Server says no.');

    await wrapper.get('#password').setValue('another-secure-pw');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('#username-error').text()).toContain('This username is taken');
    expect(document.activeElement?.id).toBe('username');
  });

  it('creates the account once even when submitted repeatedly, then reaches the shell', async () => {
    let resolve: (value: unknown) => void = () => undefined;
    const fetchMock = mockApi(signedOut);
    const base = globalThis.fetch;
    vi.stubGlobal('fetch', (input: string, init?: RequestInit) =>
      input === '/api/v1/auth/register'
        ? (fetchMock(input, init), new Promise((done) => (resolve = done)))
        : base(input, init),
    );
    const { wrapper, router } = await mountApp('/register');
    await fill(wrapper, 'learner', 'a-secure-password');
    await wrapper.get('form').trigger('submit');
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(authCalls(fetchMock)).toHaveLength(1);
    const button = wrapper.get('button[type="submit"]');
    expect(button.attributes('aria-busy')).toBe('true');
    expect(button.text()).toBe('Creating account...');

    resolve({ ok: true, status: 201, json: async () => ({ user: learner }) });
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/practice');
    expect(wrapper.text()).toContain('TapTalk practice desk');
  });
});

describe('login screen', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('requires both fields but does not apply the registration policy', async () => {
    const fetchMock = mockApi({
      ...signedOut,
      'POST /api/v1/auth/login': { body: { user: learner } },
    });
    const { wrapper, router } = await mountApp('/login');
    await wrapper.get('form').trigger('submit');
    expect(wrapper.get('#username-error').text()).toBe('Enter your username.');
    expect(wrapper.get('#password-error').text()).toBe('Enter your password.');
    expect(authCalls(fetchMock)).toHaveLength(0);

    await fill(wrapper, 'old', 'short'); // accounts from older rules can still sign in
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(authCalls(fetchMock)).toHaveLength(1);
    expect(router.currentRoute.value.path).toBe('/practice');
  });

  it('shows a safe message for wrong credentials and an outage', async () => {
    mockApi({
      ...signedOut,
      'POST /api/v1/auth/login': {
        status: 401,
        body: { error: { code: 'INVALID_LOGIN', message: 'Username or password is invalid.' } },
      },
    });
    const { wrapper } = await mountApp('/login');
    await fill(wrapper, 'learner', 'wrong-password');
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toBe('Username or password is invalid.');

    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(wrapper.get('[role="alert"]').text()).toContain('service is unavailable');
  });

  it('toggles password visibility accessibly', async () => {
    mockApi(signedOut);
    const { wrapper } = await mountApp('/login');
    const toggle = wrapper.get('button[aria-controls="password"]');
    expect(wrapper.get('#password').attributes('type')).toBe('password');
    expect(toggle.attributes('aria-pressed')).toBe('false');
    expect(toggle.text()).toBe('Show password');

    await toggle.trigger('click');
    expect(wrapper.get('#password').attributes('type')).toBe('text');
    expect(toggle.attributes('aria-pressed')).toBe('true');
    expect(toggle.text()).toBe('Hide password');
  });

  it('keeps the return path when switching between login and registration', async () => {
    mockApi(signedOut);
    const { wrapper } = await mountApp('/login?redirect=/settings');
    expect(wrapper.get('a.btn--text').attributes('href')).toBe('/register?redirect=/settings');
  });
});
