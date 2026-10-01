// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import { createI18n } from 'vue-i18n';
import { createRouter, createMemoryHistory } from 'vue-router';
import SharedResultView from './SharedResultView.vue';
import en from '../locales/en.json';
import de from '../locales/de.json';
import es from '../locales/es.json';

const PAYLOAD = {
  kind: 'exam',
  direction: 'english-to-german',
  correctCount: 18,
  totalQuestions: 20,
  score: 90,
  sharedAt: '2026-01-01T00:00:00.000Z',
};

function stubRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: SharedResultView },
      { path: '/share/:token', component: SharedResultView, props: true },
      { path: '/register', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ],
  });
}

async function mountPage(options: {
  ok: boolean;
  body?: unknown;
  token?: string;
  locale?: string;
}): Promise<{ wrapper: ReturnType<typeof mount>; fetchMock: ReturnType<typeof vi.fn> }> {
  const fetchMock =
    options.ok === undefined
      ? vi.fn()
      : vi.fn().mockResolvedValue({
          ok: options.ok,
          json: async () => (options.ok ? { result: options.body } : { error: {} }),
        });
  vi.stubGlobal('fetch', fetchMock);
  const i18n = createI18n({
    legacy: false,
    locale: options.locale ?? 'en',
    fallbackLocale: 'en',
    messages: { en, de, es },
  });
  const router = stubRouter();
  await router.push('/share/abc');
  await router.isReady();
  const wrapper = mount(SharedResultView, {
    props: { token: options.token ?? 'abc' },
    global: { plugins: [i18n, router] },
  });
  await flushPromises();
  return { wrapper, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SharedResultView', () => {
  it('renders the sanitized result for an anonymous visitor', async () => {
    const { wrapper, fetchMock } = await mountPage({ ok: true, body: PAYLOAD });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/share/card/abc');
    expect(wrapper.text()).toContain('18 / 20');
    expect(wrapper.text()).toContain('90%');
    expect(wrapper.text()).toContain('Exam');
    expect(wrapper.text()).toContain('English → German');
  });

  it('exposes the result to a screen reader as a sentence', async () => {
    const { wrapper } = await mountPage({ ok: true, body: PAYLOAD });
    const summary = wrapper.find('.visually-hidden').text();
    expect(summary).toContain('18');
    expect(summary).toContain('20');
    expect(summary).toContain('90');
    // The visible numbers are hidden from assistive tech to avoid a double read.
    expect(wrapper.get('.share-public__score').attributes('aria-hidden')).toBe('true');
  });

  it('offers a path to try TapTalk and to log in', async () => {
    const { wrapper } = await mountPage({ ok: true, body: PAYLOAD });
    const text = wrapper.text();
    expect(text).toContain('Try TapTalk');
    expect(text).toContain('Log in');
    // The recipient learns what TapTalk is before being asked to register.
    expect(text).toContain('free vocabulary trainer');
  });

  it('does not put the learner’s identity anywhere on the page', async () => {
    const { wrapper } = await mountPage({ ok: true, body: PAYLOAD });
    expect(wrapper.text()).not.toMatch(/username|learner|password/i);
  });

  it('shows one calm state for an unknown or revoked share', async () => {
    const { wrapper } = await mountPage({ ok: false });
    expect(wrapper.text()).toContain('This shared result is not available');
    // No distinction between "never existed" and "revoked": that would let a
    // caller test whether a token once existed.
    expect(wrapper.text()).not.toContain('revoked');
    expect(wrapper.text()).not.toContain('expired');
  });

  it('shows the unavailable state when the request fails outright', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en, de, es } });
    const router = stubRouter();
    await router.push('/share/abc');
    await router.isReady();
    const wrapper = mount(SharedResultView, {
      props: { token: 'abc' },
      global: { plugins: [i18n, router] },
    });
    await flushPromises();
    expect(wrapper.text()).toContain('This shared result is not available');
  });

  it('encodes the token when building the request', async () => {
    const { fetchMock } = await mountPage({
      ok: false,
      token: '../../admin',
    });
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/share/card/..%2F..%2Fadmin');
  });

  it('renders in the active locale', async () => {
    const { wrapper } = await mountPage({ ok: true, body: PAYLOAD, locale: 'de' });
    expect(wrapper.text()).toContain('Jemand hat eine TapTalk-Runde geschafft!');
    expect(wrapper.text()).toContain('Anmelden');
  });

  it('writes nothing to localStorage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await mountPage({ ok: true, body: PAYLOAD });
    // Referral tracking is a server-side cookie; the page adds no client tracking.
    expect(setItem).not.toHaveBeenCalled();
  });
});
