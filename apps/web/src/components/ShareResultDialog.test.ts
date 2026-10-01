// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import type { ShareResultPayload } from '@taptalk/shared';
import { createI18n } from 'vue-i18n';
import ShareResultDialog from './ShareResultDialog.vue';
import en from '../locales/en.json';
import de from '../locales/de.json';
import es from '../locales/es.json';

const payload: ShareResultPayload = {
  kind: 'exam',
  direction: 'english-to-german',
  correctCount: 18,
  totalQuestions: 20,
  score: 90,
  sharedAt: '2026-01-01T00:00:00.000Z',
};

/** happy-dom has no canvas; the renderer itself is covered in share-card.test.ts. */
function stubCanvas(): void {
  const context = {
    fillRect: () => {},
    fillText: () => {},
    measureText: () => ({ width: 10 }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arcTo: () => {},
    closePath: () => {},
    fill: () => {},
    stroke: () => {},
    save: () => {},
    restore: () => {},
    set fillStyle(_v: unknown) {},
    set strokeStyle(_v: unknown) {},
    set lineWidth(_v: unknown) {},
    set font(_v: unknown) {},
    set textAlign(_v: unknown) {},
    set textBaseline(_v: unknown) {},
  };
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    value: () => context,
    configurable: true,
  });
  Object.defineProperty(HTMLCanvasElement.prototype, 'toBlob', {
    value: (callback: (blob: Blob | null) => void) =>
      callback(new Blob(['png'], { type: 'image/png' })),
    configurable: true,
  });
}

function mountDialog(overrides: Record<string, unknown> = {}, locale = 'en') {
  const i18n = createI18n({
    legacy: false,
    locale,
    fallbackLocale: 'en',
    messages: { en, de, es },
  });
  return mount(ShareResultDialog, {
    props: { open: true, path: '/share/abc', payload, ...overrides },
    global: { plugins: [i18n] },
    attachTo: document.body,
  });
}

const originalShare = navigator.share;
const originalCanShare = navigator.canShare;
const originalClipboard = navigator.clipboard;

beforeEach(() => {
  stubCanvas();
});

afterEach(() => {
  Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: originalCanShare, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  vi.restoreAllMocks();
});
describe('ShareResultDialog', () => {
  it('renders the API score, not a recomputed one', () => {
    const wrapper = mountDialog();
    const preview = wrapper.get('[data-testid="share-preview"]').text();
    expect(preview).toContain('18 / 20');
    expect(preview).toContain('90%');
  });

  it('has correct dialog semantics', () => {
    const wrapper = mountDialog();
    const dialog = wrapper.get('[role="dialog"]');
    expect(dialog.attributes('aria-modal')).toBe('true');
    expect(dialog.attributes('aria-labelledby')).toBe('share-dialog-title');
    expect(wrapper.find('#share-dialog-title').exists()).toBe(true);
  });

  it('moves focus into the dialog when it opens', async () => {
    mountDialog();
    await flushPromises();
    // The focus move is scheduled on the next frame so it runs after the dialog
    // has been painted.
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(document.activeElement?.tagName).toBe('BUTTON');
  });

  it('closes on Escape', async () => {
    const wrapper = mountDialog();
    await wrapper.get('[role="dialog"]').trigger('keydown', { key: 'Escape' });
    expect(wrapper.emitted('close')).toHaveLength(1);
  });

  it('offers native share when the browser supports it', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    const wrapper = mountDialog();
    await flushPromises();
    const nativeButton = wrapper.findAll('button').find((b) => b.text() === 'Share');
    expect(nativeButton).toBeDefined();
    await nativeButton!.trigger('click');
    await flushPromises();
    expect(share).toHaveBeenCalled();
    const data = share.mock.calls[0]![0] as ShareData;
    expect(data.text).toContain('18/20');
    expect(String(data.url ?? data.text)).toContain('/share/abc');
  });

  it('falls back to copy link when native share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    const wrapper = mountDialog();
    await flushPromises();
    const copyButton = wrapper.findAll('button').find((b) => b.text() === 'Copy link');
    expect(copyButton).toBeDefined();
    await copyButton!.trigger('click');
    await flushPromises();
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('/share/abc'));
    expect(wrapper.text()).toContain('Link copied.');
  });

  it('keeps the fallback actions visible even when native share exists', async () => {
    Object.defineProperty(navigator, 'share', {
      value: vi.fn().mockResolvedValue(undefined),
      configurable: true,
    });
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    const wrapper = mountDialog();
    await flushPromises();
    // A desktop browser can offer the sheet and still refuse files, so the copy
    // actions are never hidden behind it.
    expect(wrapper.findAll('button').some((b) => b.text() === 'Copy link')).toBe(true);
    expect(wrapper.findAll('button').some((b) => b.text() === 'Copy message')).toBe(true);
  });

  it('copies a message containing the score and the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const wrapper = mountDialog();
    await flushPromises();
    await wrapper
      .findAll('button')
      .find((b) => b.text() === 'Copy message')!
      .trigger('click');
    await flushPromises();
    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toContain('18/20');
    expect(copied).toContain('/share/abc');
  });

  it('renders in the active locale', async () => {
    const wrapper = mountDialog({}, 'de');
    await flushPromises();
    expect(wrapper.text()).toContain('Teile dein Ergebnis');
    expect(wrapper.text()).toContain('Prüfung');
    expect(wrapper.text()).toContain('Englisch → Deutsch');
    expect(wrapper.text()).toContain('Link kopieren');
  });

  it('says the learner’s name is never shared', () => {
    expect(mountDialog().text()).toContain('Your name is never included');
  });

  it('renders nothing when closed', () => {
    expect(mountDialog({ open: false }).find('[role="dialog"]').exists()).toBe(false);
  });
});
