// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.vue';
import { mockApi, signedIn } from './test-api';

describe('progress view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders dashboard values for a restored session', async () => {
    mockApi({
      ...signedIn,
      'GET /api/v1/dashboard': {
        body: {
          dashboard: {
            totalPoints: 42,
            totalAttempts: 8,
            accuracy: 0.75,
            recentActivity: [],
            repeatedErrorWords: ['house'],
          },
        },
      },
    });
    const wrapper = mount(App);
    await flushPromises();
    const progressTab = wrapper
      .findAll('button.tab')
      .find((button) => button.text() === 'Progress');
    await progressTab?.trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('42');
    expect(wrapper.text()).toContain('75%');
    expect(wrapper.text()).toContain('house');
  });
});
