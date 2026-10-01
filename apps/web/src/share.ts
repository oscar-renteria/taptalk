import type { ShareResultPayload } from '@taptalk/shared';

/**
 * Share plumbing: the public URL, the localized message, and the two ways a
 * learner can get it out of the app -- the OS share sheet where it exists, and a
 * clipboard fallback where it does not.
 *
 * No social network is integrated. On a phone the OS share sheet is what puts
 * WhatsApp and SMS one tap away; on a desktop the clipboard is the fallback.
 * Nothing here contacts a third party.
 */

export type ShareMessages = {
  headline: string;
  invitation: string;
  tryTapTalk: string;
};

/**
 * The absolute public URL for a share.
 *
 * Built from `window.location.origin` rather than an API-supplied host: the API
 * does not know the public origin, and accepting one from the client would let a
 * caller aim the link at a look-alike domain. The path comes from the API and is
 * always same-origin.
 */
export function shareUrl(path: string, origin?: string): string {
  const base = origin ?? (typeof window === 'undefined' ? '' : window.location.origin);
  return `${base}${path}`;
}

/**
 * The message a learner sends. Number formatting follows the active locale, but
 * every word is passed in already translated.
 */
export function buildShareMessage(
  payload: ShareResultPayload,
  url: string,
  messages: ShareMessages,
  locale = 'en',
): string {
  const format = (value: number) => {
    try {
      return new Intl.NumberFormat(locale).format(value);
    } catch {
      return String(value);
    }
  };
  const headline = messages.headline
    .replace('{correct}', format(payload.correctCount))
    .replace('{total}', format(payload.totalQuestions));
  return `${headline}\n\n${messages.invitation}\n${messages.tryTapTalk} ${url}`;
}

/** The text the recipient reads, without the learner's own score. */
export function buildPublicInvitation(
  payload: ShareResultPayload,
  invitation: string,
  locale = 'en',
): string {
  const format = (value: number) => {
    try {
      return new Intl.NumberFormat(locale).format(value);
    } catch {
      return String(value);
    }
  };
  return `${invitation
    .replace('{correct}', format(payload.correctCount))
    .replace('{total}', format(payload.totalQuestions))} ${format(payload.score)}%`;
}

/** True when this browser can open the OS share sheet at all. */
export function canNativeShare(target: ShareData | undefined = undefined): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.share === 'function'
    ? navigator.canShare?.(target ?? { text: '' }) !== false
    : false;
}

/**
 * True when the OS can take the result image itself, not just text. Desktop
 * browsers frequently expose `share()` but reject files, which is why the
 * fallback stays visible rather than being hidden behind the share button.
 */
export function canShareFiles(files: File[]): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return false;
  if (typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files });
  } catch {
    return false;
  }
}

export type ShareOutcome = 'shared' | 'dismissed' | 'unsupported' | 'failed';

/**
 * Hand the share to the OS. A user-cancelled sheet is a normal outcome, not an
 * error, so it is reported separately rather than surfaced as a failure.
 */
export async function nativeShare(data: ShareData): Promise<ShareOutcome> {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') {
    return 'unsupported';
  }
  try {
    await navigator.share(data);
    return 'shared';
  } catch (error) {
    return error instanceof DOMException && error.name === 'AbortError' ? 'dismissed' : 'failed';
  }
}

/**
 * Copy text, preferring the async Clipboard API and falling back to a hidden
 * textarea plus `execCommand`, which is still the only option in older mobile
 * browsers on insecure origins.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path below.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/** Offer a generated PNG to the browser as a download. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Released on the next frame so the download has taken the reference.
  requestAnimationFrame(() => URL.revokeObjectURL(url));
}
