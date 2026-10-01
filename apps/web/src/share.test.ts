// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShareResultPayload } from '@taptalk/shared';
import {
  buildPublicInvitation,
  buildShareMessage,
  canNativeShare,
  canShareFiles,
  copyText,
  nativeShare,
  shareUrl,
  type ShareMessages,
} from './share';

const messages: ShareMessages = {
  headline: 'I got {correct}/{total} right in TapTalk!',
  invitation: 'Can you beat my score?',
  tryTapTalk: 'Try TapTalk',
};

const payload: ShareResultPayload = {
  kind: 'exam',
  direction: 'english-to-german',
  correctCount: 18,
  totalQuestions: 20,
  score: 90,
  sharedAt: '2026-01-01T00:00:00.000Z',
};

const originalShare = navigator.share;
const originalCanShare = navigator.canShare;
const originalClipboard = navigator.clipboard;

afterEach(() => {
  Object.defineProperty(navigator, 'share', { value: originalShare, configurable: true });
  Object.defineProperty(navigator, 'canShare', { value: originalCanShare, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: originalClipboard, configurable: true });
  vi.restoreAllMocks();
});

function setNavigator(props: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(props)) {
    Object.defineProperty(navigator, key, { value, configurable: true });
  }
}

describe('share url', () => {
  it('builds an absolute same-origin URL from the API path', () => {
    expect(shareUrl('/share/abc', 'https://taptalk.test')).toBe('https://taptalk.test/share/abc');
  });

  it('takes the origin from the browser, not from the API payload', () => {
    // The host comes from `window.location.origin` only, so a tampered share
    // response cannot aim the link at a look-alike domain.
    expect(shareUrl('/share/abc', 'https://taptalk.test')).not.toContain('evil');
  });
});

describe('share message', () => {
  it('fills in the API score and ends with the link', () => {
    const message = buildShareMessage(payload, 'https://taptalk.test/share/abc', messages, 'en');
    expect(message).toContain('18/20');
    expect(message).toContain('Can you beat my score?');
    expect(message).toContain('https://taptalk.test/share/abc');
  });

  it('formats the numbers for the active locale', () => {
    const message = buildShareMessage(
      { ...payload, correctCount: 1234, totalQuestions: 2000 },
      'https://taptalk.test/share/abc',
      messages,
      'de',
    );
    expect(message).toContain('1.234/2.000');
  });

  it('uses the caller’s translations', () => {
    const message = buildShareMessage(
      payload,
      'https://taptalk.test/share/abc',
      {
        headline: 'Ich habe {correct}/{total} richtig!',
        invitation: 'Kannst du meinen Punktestand schlagen?',
        tryTapTalk: 'TapTalk ausprobieren',
      },
      'de',
    );
    expect(message).toContain('Ich habe 18/20 richtig!');
    expect(message).not.toContain('Can you beat');
  });

  it('builds the recipient invitation from the same sanitized payload', () => {
    expect(buildPublicInvitation(payload, '{correct} of {total} right', 'en')).toBe(
      '18 of 20 right 90%',
    );
  });
});

describe('native share support', () => {
  it('is false without a share function', () => {
    setNavigator({ share: undefined, canShare: undefined });
    expect(canNativeShare()).toBe(false);
  });

  it('is true when the browser can share text', () => {
    setNavigator({ share: () => Promise.resolve(), canShare: () => true });
    expect(canNativeShare({ text: 'hi' })).toBe(true);
  });

  it('is false when the browser rejects the payload', () => {
    setNavigator({ share: () => Promise.resolve(), canShare: () => false });
    expect(canNativeShare({ text: 'hi' })).toBe(false);
  });

  it('reports file support only when canShare accepts files', () => {
    setNavigator({ share: () => Promise.resolve(), canShare: () => false });
    expect(canShareFiles([new File(['x'], 'a.png')])).toBe(false);
    setNavigator({ share: () => Promise.resolve(), canShare: () => true });
    expect(canShareFiles([new File(['x'], 'a.png')])).toBe(true);
  });

  it('reports no file support when canShare throws', () => {
    setNavigator({
      share: () => Promise.resolve(),
      canShare: () => {
        throw new Error('nope');
      },
    });
    expect(canShareFiles([new File(['x'], 'a.png')])).toBe(false);
  });
});
describe('native share outcome', () => {
  it('reports unsupported without a share function', async () => {
    setNavigator({ share: undefined });
    await expect(nativeShare({ text: 'hi' })).resolves.toBe('unsupported');
  });

  it('reports success', async () => {
    setNavigator({ share: () => Promise.resolve() });
    await expect(nativeShare({ text: 'hi' })).resolves.toBe('shared');
  });

  it('treats a cancelled sheet as a normal outcome, not a failure', async () => {
    setNavigator({
      share: () => Promise.reject(new DOMException('cancelled', 'AbortError')),
    });
    await expect(nativeShare({ text: 'hi' })).resolves.toBe('dismissed');
  });

  it('reports a real failure', async () => {
    setNavigator({
      share: () => Promise.reject(new DOMException('boom', 'NotAllowedError')),
    });
    await expect(nativeShare({ text: 'hi' })).resolves.toBe('failed');
  });
});

describe('copying', () => {
  it('uses the clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hello');
  });

  it('falls back when the clipboard API rejects', async () => {
    setNavigator({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) } });
    const exec = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
    await expect(copyText('hello')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
  });

  it('reports failure when nothing works', async () => {
    setNavigator({ clipboard: undefined });
    Object.defineProperty(document, 'execCommand', {
      value: vi.fn().mockReturnValue(false),
      configurable: true,
    });
    await expect(copyText('hello')).resolves.toBe(false);
  });
});
