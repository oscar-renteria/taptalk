// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import de from './locales/de.json';
import en from './locales/en.json';
import es from './locales/es.json';
import { i18n, setLocale, supportedLocales } from './i18n';

function flatten(
  value: unknown,
  prefix = '',
  out: Record<string, string> = {},
): Record<string, string> {
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object') flatten(child, path, out);
    else out[path] = String(child);
  }
  return out;
}

const enFlat = flatten(en);
const deFlat = flatten(de);
const esFlat = flatten(es);

describe('translation resources', () => {
  it('defines exactly the same keys in every language', () => {
    expect(Object.keys(deFlat).sort()).toEqual(Object.keys(enFlat).sort());
    expect(Object.keys(esFlat).sort()).toEqual(Object.keys(enFlat).sort());
  });

  it('leaves no value empty', () => {
    for (const [locale, flat] of Object.entries({ en: enFlat, de: deFlat, es: esFlat })) {
      for (const [key, value] of Object.entries(flat)) {
        expect(value.trim(), `${locale}.${key} is empty`).not.toBe('');
      }
    }
  });

  it('keeps interpolation placeholders identical across languages', () => {
    // Compare the set of variable names: a pipe-separated plural form may
    // legitimately repeat {count} in each branch, but must not introduce or
    // drop a variable.
    const placeholders = (text: string) =>
      [...new Set([...text.matchAll(/\{([a-zA-Z]+)\}/g)].map((match) => match[1]))].sort();
    for (const key of Object.keys(enFlat)) {
      expect(placeholders(deFlat[key]!), `de.${key}`).toEqual(placeholders(enFlat[key]!));
      expect(placeholders(esFlat[key]!), `es.${key}`).toEqual(placeholders(enFlat[key]!));
    }
  });

  it('actually translates: German and Spanish differ from English', () => {
    for (const key of ['nav.practice', 'nav.settings', 'common.tryAgain', 'practice.correct']) {
      expect(deFlat[key]!, `de.${key}`).not.toBe(enFlat[key]!);
      expect(esFlat[key]!, `es.${key}`).not.toBe(enFlat[key]!);
    }
  });

  it('keeps the product name untranslated', () => {
    expect(deFlat['app.name']).toBe('TapTalk');
    expect(esFlat['app.name']).toBe('TapTalk');
  });
});

describe('locale selection', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(async () => {
    await setLocale('en');
    localStorage.clear();
  });

  it('supports exactly English, German, and Spanish', () => {
    expect(supportedLocales.map((entry) => entry.code)).toEqual(['en', 'de', 'es']);
  });

  it('persists an explicit choice and applies it', async () => {
    await setLocale('de');
    expect(i18n.global.locale.value).toBe('de');
    expect(localStorage.getItem('taptalk.locale')).toBe('de');
  });

  it('translates through the i18n instance in the active language', async () => {
    await setLocale('de');
    expect(i18n.global.t('nav.practice')).toBe(de.nav.practice);
    await setLocale('es');
    expect(i18n.global.t('nav.practice')).toBe(es.nav.practice);
    await setLocale('en');
    expect(i18n.global.t('nav.practice')).toBe(en.nav.practice);
  });

  it('ignores an unsupported stored language and falls back to English', async () => {
    localStorage.setItem('taptalk.locale', 'fr');
    await setLocale('en');
    expect(i18n.global.t('nav.practice')).toBe(en.nav.practice);
  });
});

describe('browser translation protection and document language', () => {
  afterEach(async () => {
    await setLocale('en');
  });

  it('marks the root as not machine-translatable and sets the UI language', async () => {
    await setLocale('de');
    expect(document.documentElement.getAttribute('lang')).toBe('de');
    expect(document.documentElement.getAttribute('translate')).toBe('no');

    await setLocale('es');
    expect(document.documentElement.getAttribute('lang')).toBe('es');

    await setLocale('en');
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });
});

describe('locale-aware number formatting', () => {
  it('follows the active language separators', () => {
    expect(new Intl.NumberFormat('en').format(1234.56)).toBe('1,234.56');
    expect(new Intl.NumberFormat('de').format(1234.56)).toBe('1.234,56');
  });

  it('formats percentages with the locale percent style', () => {
    const percent = (locale: string) =>
      new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(0.75);
    // English writes 75% with no space; German uses a non-breaking space (U+00A0),
    // which is correct ICU output and must not be normalised away.
    expect(percent('en')).toBe('75%');
    expect(percent('de')).toBe('75\u00a0%');
  });
});
