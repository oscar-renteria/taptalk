// @vitest-environment happy-dom

import { flushPromises, mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { UpdateBanner } from './components';
import { pwa, setupPwa } from './pwa';

function register() {
  const update = vi.fn(async () => undefined);
  let callbacks: { onNeedRefresh?: () => void; onOfflineReady?: () => void } = {};
  const registerSW = vi.fn((options: typeof callbacks & { immediate?: boolean }) => {
    callbacks = options;
    return update;
  });
  setupPwa(registerSW);
  return { registerSW, update, callbacks: () => callbacks };
}

describe('service worker updates', () => {
  it('registers immediately and waits for the learner before reloading into a new version', async () => {
    const { registerSW, update, callbacks } = register();
    expect(registerSW).toHaveBeenCalledWith(expect.objectContaining({ immediate: true }));
    const banner = mount(UpdateBanner);
    expect(banner.text()).toBe('');

    callbacks().onNeedRefresh?.();
    await flushPromises();
    expect(banner.get('[role="status"]').text()).toBe('A new version of TapTalk is ready.');
    expect(update).not.toHaveBeenCalled();

    await banner.findAll('button')[0]?.trigger('click');
    expect(update).toHaveBeenCalledWith(true);
    expect(pwa.updateAvailable).toBe(false);
  });

  it('can postpone the update', async () => {
    const { update, callbacks } = register();
    const banner = mount(UpdateBanner);
    callbacks().onNeedRefresh?.();
    await flushPromises();
    await banner.findAll('button')[1]?.trigger('click');
    expect(banner.text()).toBe('');
    expect(update).not.toHaveBeenCalled();
  });

  it('records when the app shell is available offline', () => {
    const { callbacks } = register();
    callbacks().onOfflineReady?.();
    expect(pwa.offlineReady).toBe(true);
  });
});
