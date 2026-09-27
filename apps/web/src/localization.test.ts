// @vitest-environment happy-dom

import { flushPromises } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from './i18n';
import { mockApi, mountApp, signedIn } from './test-api';

/**
 * The interface language and the language being practised are independent.
 * These tests pin that separation: switching the UI to German or Spanish must
 * translate the buttons and labels while leaving the learning material in its
 * own language and keeping that material's own `lang` attribute intact.
 */
describe('UI language and learning-content language stay independent', () => {
  afterEach(async () => {
    await setLocale('en');
  });

  async function mountPractice(direction: string, prompt: string) {
    mockApi({
      ...signedIn,
      'POST /api/v1/practice/sessions': {
        status: 201,
        body: { session: { id: 'session-1', questionCount: 1, answeredCount: 0 } },
      },
      'GET /api/v1/practice/question': {
        body: { question: { vocabularyEntryId: 'e1', direction, prompt, phonetics: null } },
      },
    });
    const { wrapper } = await mountApp('/practice');
    return wrapper;
  }

  it('translates the interface but leaves the English prompt in English', async () => {
    const wrapper = await mountPractice('english-to-german', 'hello');
    await setLocale('de');
    expect(wrapper.text()).toContain('Richtung');
    expect(document.documentElement.getAttribute('lang')).toBe('de');

    const start = wrapper.findAll('button').find((b) => b.text().includes('Üben starten'));
    expect(start, 'the German primary action is shown').toBeTruthy();
    await start!.trigger('click');
    await flushPromises();

    // German interface, English learning content.
    const promptText = wrapper.get('[data-testid="practice-prompt"]');
    expect(promptText.text()).toContain('hello');
    expect(promptText.attributes('lang')).toBe('en');
    expect(wrapper.text()).toContain('Antwort prüfen');
  });

  it('marks a German prompt as German under a Spanish interface', async () => {
    const wrapper = await mountPractice('german-to-english', 'Hallo');
    await setLocale('es');
    expect(document.documentElement.getAttribute('lang')).toBe('es');

    const start = wrapper.findAll('button').find((b) => b.text().includes('Empezar a practicar'));
    expect(start, 'the Spanish primary action is shown').toBeTruthy();
    await start!.trigger('click');
    await flushPromises();

    // Spanish interface, German learning content: the content keeps its language.
    const promptText = wrapper.get('[data-testid="practice-prompt"]');
    expect(promptText.text()).toContain('Hallo');
    expect(promptText.attributes('lang')).toBe('de');
  });

  it('switches the login interface language without a reload', async () => {
    mockApi({ 'GET /api/v1/auth/session': { status: 401 } });
    const { wrapper } = await mountApp('/login');
    await setLocale('de');
    expect(wrapper.text()).toContain('Anmelden');
    expect(document.documentElement.getAttribute('lang')).toBe('de');
    await setLocale('es');
    expect(wrapper.text()).toContain('Iniciar sesión');
    expect(document.documentElement.getAttribute('lang')).toBe('es');
  });
});
