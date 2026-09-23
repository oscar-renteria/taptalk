// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { createMemoryHistory } from 'vue-router';
import App from './App.vue';
import { createAppRouter } from './router';
import { resetSession } from './session';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bodyOf, mockApi, mountApp, signedIn } from './test-api';

const storedSettings = {
  direction: 'german-to-english',
  sessionLength: 5,
  repetitionPreference: 'errors-first',
};

describe('settings view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('loads and saves all stored preferences without overwriting them', async () => {
    const fetchMock = mockApi({
      ...signedIn,
      'GET /api/v1/settings': { body: { settings: storedSettings } },
      'PUT /api/v1/settings': { body: { settings: storedSettings } },
    });

    const { wrapper } = await mountApp('/settings');
    expect((wrapper.get('#settings-direction').element as HTMLSelectElement).value).toBe(
      'german-to-english',
    );
    expect((wrapper.get('#settings-session-length').element as HTMLInputElement).value).toBe('5');

    await wrapper.get('#settings-direction').setValue('english-to-german');
    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save settings');
    await saveButton?.trigger('click');
    await flushPromises();
    expect(bodyOf(fetchMock, 'PUT /api/v1/settings')).toEqual({
      direction: 'english-to-german',
      sessionLength: 5,
      repetitionPreference: 'errors-first',
    });
    expect(wrapper.text()).toContain('Settings saved.');
  });

  it('locks the form while stored settings are loading', async () => {
    let resolveSettings: (value: unknown) => void = () => undefined;
    mockApi(signedIn);
    const pending = new Promise((resolve) => {
      resolveSettings = resolve;
    });
    const baseFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: string, init?: RequestInit) =>
      input === '/api/v1/settings' && !init?.method ? pending : baseFetch(input, init),
    );

    resetSession();
    const router = createAppRouter(createMemoryHistory());
    await router.push('/settings');
    const wrapper = mount(App, { global: { plugins: [router] } });
    await flushPromises();
    expect(wrapper.get('fieldset').attributes('disabled')).toBeDefined();

    resolveSettings({ ok: true, status: 200, json: async () => ({ settings: storedSettings }) });
    await flushPromises();
    expect(wrapper.get('fieldset').attributes('disabled')).toBeUndefined();
  });
});
