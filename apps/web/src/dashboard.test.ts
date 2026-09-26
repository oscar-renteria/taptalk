// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockApi, mountApp, signedIn } from './test-api';

const dashboard = {
  totalPoints: 42,
  totalAttempts: 8,
  accuracy: 0.75,
  recentActivity: [],
  repeatedErrorWords: ['house'],
};

describe('progress view', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('renders dashboard values for a restored session', async () => {
    mockApi({ ...signedIn, 'GET /api/v1/dashboard': { body: { dashboard } } });
    const { wrapper } = await mountApp('/progress');

    expect(wrapper.text()).toContain('42');
    expect(wrapper.text()).toContain('75%');
    expect(wrapper.text()).toContain('house');
  });

  it('offers a retry when the dashboard cannot be loaded', async () => {
    mockApi({
      ...signedIn,
      'GET /api/v1/dashboard': [{ status: 500, body: {} }, { body: { dashboard } }],
    });
    const { wrapper } = await mountApp('/progress');
    expect(wrapper.get('[role="alert"]').text()).toContain('could not be loaded');

    await wrapper.get('.error-state button').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('42');
  });

  it('explains an empty history and offers a way to start practising', async () => {
    mockApi({
      ...signedIn,
      'GET /api/v1/dashboard': {
        body: { dashboard: { ...dashboard, totalAttempts: 0, repeatedErrorWords: [] } },
      },
    });
    const { wrapper } = await mountApp('/progress');

    // Empty states must answer what is empty, why, and what to do next.
    expect(wrapper.text()).toContain('No history yet');
    expect(wrapper.text()).toContain('Answer a few questions');
    expect(wrapper.text()).toContain('Start practising');
  });

  it('distinguishes a brand new learner from one with attempts but no repeats', async () => {
    mockApi({
      ...signedIn,
      'GET /api/v1/dashboard': { body: { dashboard: { ...dashboard, repeatedErrorWords: [] } } },
    });
    const { wrapper } = await mountApp('/progress');

    expect(wrapper.text()).toContain('nothing has come up twice yet');
  });
});
