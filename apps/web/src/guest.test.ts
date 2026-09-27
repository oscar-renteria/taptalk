// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  forgetGuestState,
  recallGuestState,
  rememberGuestState,
  startGuestSession,
  endGuestSession,
} from './guest';
import { actorKind, session, signIn, signOut } from './session';
import { asGuest, endGuest, mockApi, mountApp, signedOut, startGuest } from './test-api';

describe('guest session on the client', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    forgetGuestState();
    signOut();
    localStorage.clear();
  });

  it('starts a guest session and reports it as a guest, not a user', async () => {
    mockApi(startGuest);
    expect(session.user).toBeNull();
    await startGuestSession();
    expect(session.guest).toBe(true);
    expect(session.user).toBeNull();
    expect(actorKind()).toBe('guest');
  });

  it('leaves the visitor signed out when the server refuses', async () => {
    mockApi({ 'POST /api/v1/auth/guest': { status: 500, body: { error: { message: 'no' } } } });
    expect(await startGuestSession()).toBe(false);
    expect(session.guest).toBe(false);
    expect(actorKind()).toBe('anonymous');
  });

  it('ends the session and discards the temporary snapshot', async () => {
    mockApi({ ...startGuest, ...endGuest });
    await startGuestSession();
    rememberGuestState('guest_test', { dashboard: { totalAttempts: 7 } });
    expect(recallGuestState('guest_test')?.dashboard).toEqual({ totalAttempts: 7 });

    await endGuestSession();
    expect(session.guest).toBe(false);
    expect(recallGuestState('guest_test')).toBeUndefined();
  });

  it('keeps two guests on one browser from seeing each other', () => {
    rememberGuestState('guest_one', { dashboard: { totalAttempts: 1 } });
    rememberGuestState('guest_two', { dashboard: { totalAttempts: 2 } });
    expect(recallGuestState('guest_one')?.dashboard).toEqual({ totalAttempts: 1 });
    expect(recallGuestState('guest_two')?.dashboard).toEqual({ totalAttempts: 2 });
    // Ending one guest leaves the other intact.
    forgetGuestState('guest_one');
    expect(recallGuestState('guest_one')).toBeUndefined();
    expect(recallGuestState('guest_two')?.dashboard).toEqual({ totalAttempts: 2 });
  });

  it('survives cleared local storage without breaking guest mode', async () => {
    mockApi(startGuest);
    await startGuestSession();
    localStorage.clear();
    // No snapshot is available, but the session is still a guest.
    expect(recallGuestState('guest_test')).toBeUndefined();
    expect(actorKind()).toBe('guest');
  });

  it('is superseded by a real sign-in', () => {
    signIn({ username: 'learner', role: 'user' });
    expect(actorKind()).toBe('authenticated');
  });
});

describe('guest routing and shell', () => {
  afterEach(() => {
    signOut();
  });

  it('lets a guest reach practice, progress, and settings', async () => {
    mockApi(asGuest);
    const { router } = await mountApp('/practice');
    expect(router.currentRoute.value.name).toBe('practice');
    await router.push('/progress');
    expect(router.currentRoute.value.name).toBe('progress');
    await router.push('/settings');
    expect(router.currentRoute.value.name).toBe('settings');
  });

  it('keeps a guest out of the administrator screen', async () => {
    mockApi(asGuest);
    const { router } = await mountApp('/admin/import');
    expect(router.currentRoute.value.name).toBe('practice');
  });

  it('keeps a guest out of the account screens', async () => {
    mockApi(asGuest);
    const { router } = await mountApp('/login');
    expect(router.currentRoute.value.name).toBe('practice');
  });

  it('shows a guest indicator instead of a username', async () => {
    mockApi(asGuest);
    const { wrapper } = await mountApp('/practice');
    expect(wrapper.text()).toContain('Guest');
    expect(wrapper.text()).not.toContain('Signed in as');
  });

  it('tells the guest their progress is temporary', async () => {
    mockApi(asGuest);
    const { wrapper } = await mountApp('/practice');
    expect(wrapper.text()).toContain('You are using TapTalk as a guest');
  });

  it('offers Continue as Guest to a signed-out visitor', async () => {
    mockApi(signedOut);
    const { wrapper } = await mountApp('/login');
    const button = wrapper.findAll('button').find((b) => b.text().includes('Continue as Guest'));
    expect(button).toBeTruthy();
    expect(wrapper.text()).toContain("won't be saved to an account");
  });

  it('still sends an anonymous visitor from a protected screen to login', async () => {
    mockApi(signedOut);
    const { router } = await mountApp('/practice');
    // No guest cookie and no user: the app must not pretend it is signed in.
    expect(router.currentRoute.value.name).toBe('login');
  });
});
