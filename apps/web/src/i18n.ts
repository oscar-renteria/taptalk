import { createI18n } from 'vue-i18n';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';

export const supportedLocales = [
  { code: 'en', label: 'English' },
  { code: 'de', label: 'Deutsch' },
  { code: 'es', label: 'Español' },
] as const;

export type LocaleCode = (typeof supportedLocales)[number]['code'];

export const localeCodes: readonly string[] = supportedLocales.map((entry) => entry.code);
const fallbackLocale: LocaleCode = 'en';
const storageKey = 'taptalk.locale';

function isSupported(value: unknown): value is LocaleCode {
  return typeof value === 'string' && localeCodes.includes(value);
}

/**
 * Locale selection priority, highest first:
 *   1. an explicit choice the user just made
 *   2. the persisted choice from a previous visit
 *   3. the browser's language
 *   4. English
 *
 * The browser is consulted only when nothing has been chosen, so a later
 * change of browser language never overrides an explicit selection.
 */
function storedLocale(): LocaleCode | null {
  try {
    const value = localStorage.getItem(storageKey);
    return isSupported(value) ? value : null;
  } catch {
    // Private mode or a blocked storage partition: fall through to detection.
    return null;
  }
}

function browserLocale(): LocaleCode | null {
  if (typeof navigator === 'undefined') return null;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = String(tag).slice(0, 2).toLowerCase();
    if (isSupported(base)) return base;
  }
  return null;
}

export function initialLocale(): LocaleCode {
  return storedLocale() ?? browserLocale() ?? fallbackLocale;
}

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: initialLocale(),
  fallbackLocale,
  messages: { en, de, es },
  // Missing keys must be visible in development rather than silently empty.
  missingWarn: import.meta.env.DEV,
  fallbackWarn: import.meta.env.DEV,
});

/**
 * The root element must always state the UI language so assistive technology
 * announces the interface in the right language. Learning content carries its
 * own `lang`, which is deliberately independent of this value.
 */
function applyDocumentLanguage(locale: string): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('lang', locale);
  document.documentElement.setAttribute('translate', 'no');
}

export function currentLocale(): LocaleCode {
  return (i18n.global.locale.value as LocaleCode) ?? fallbackLocale;
}

export async function setLocale(locale: LocaleCode): Promise<void> {
  i18n.global.locale.value = locale;
  applyDocumentLanguage(locale);
  try {
    localStorage.setItem(storageKey, locale);
  } catch {
    // Persistence is best effort: the choice still applies for this session.
  }
}

export function localeTag(locale: LocaleCode): string {
  return locale;
}

applyDocumentLanguage(i18n.global.locale.value);
