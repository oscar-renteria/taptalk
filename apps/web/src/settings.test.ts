// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

describe('settings view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('loads and saves the authenticated user direction', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ user: { username: 'learner', role: 'user' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          settings: {
            direction: 'german-to-english',
            sessionLength: 10,
            repetitionPreference: 'balanced',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ settings: { direction: 'random' } }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(App);
    await wrapper.get('form').trigger('submit');
    const settingsTab = wrapper
      .findAll('button.tab')
      .find((button) => button.text() === 'Settings');
    await settingsTab?.trigger('click');
    expect((wrapper.get('#settings-direction').element as HTMLSelectElement).value).toBe(
      'german-to-english',
    );

    await wrapper.get('#settings-direction').setValue('english-to-german');
    const saveButton = wrapper
      .findAll('button')
      .find((button) => button.text() === 'Save settings');
    await saveButton?.trigger('click');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.parse(fetchMock.mock.calls[2]?.[1]?.body as string)).toMatchObject({
      direction: 'english-to-german',
    });
  });
});
