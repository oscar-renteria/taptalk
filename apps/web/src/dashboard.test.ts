// @vitest-environment happy-dom

import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';

describe('progress view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders dashboard values after authentication', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ user: { username: 'learner', role: 'user' } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            dashboard: {
              totalPoints: 42,
              totalAttempts: 8,
              accuracy: 0.75,
              recentActivity: [],
              repeatedErrorWords: ['house'],
            },
          }),
        }),
    );
    const wrapper = mount(App);
    await wrapper.get('form').trigger('submit');
    const progressTab = wrapper
      .findAll('button.tab')
      .find((button) => button.text() === 'Progress');
    await progressTab?.trigger('click');

    expect(wrapper.text()).toContain('42');
    expect(wrapper.text()).toContain('75%');
    expect(wrapper.text()).toContain('house');
  });
});
