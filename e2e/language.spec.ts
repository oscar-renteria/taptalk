import { expect, test } from '@playwright/test';
import { logIn, registerLearner } from './support/app';
import { learnerPassword } from './support/environment';

const htmlLang = (page: import('@playwright/test').Page) =>
  page.locator('html').getAttribute('lang');

test.describe('application language', () => {
  test('a signed-out visitor reads the login screen in the chosen language', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'Log in to practise' })).toBeVisible();

    await page.getByLabel('App language').selectOption('de');
    await expect(page.getByRole('heading', { name: 'Zum Üben anmelden' })).toBeVisible();
    expect(await htmlLang(page)).toBe('de');

    await page.getByLabel('App-Sprache').selectOption('es');
    await expect(page.getByRole('heading', { name: 'Inicia sesión para practicar' })).toBeVisible();
    expect(await htmlLang(page)).toBe('es');

    await page.getByLabel('Idioma de la aplicación').selectOption('en');
    await expect(page.getByRole('heading', { name: 'Log in to practise' })).toBeVisible();
    expect(await htmlLang(page)).toBe('en');
  });

  test('the choice survives a reload and navigation', async ({ page, request }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'locale');
    await page.goto('/login');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(learnerPassword);
    await page.getByRole('button', { name: 'Log in' }).click();

    await page.getByLabel('App language').selectOption('de');
    await expect(
      page
        .getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('link', { name: 'Fortschritt' }),
    ).toBeVisible();
    expect(await htmlLang(page)).toBe('de');

    // A reload restores the stored preference rather than the browser default.
    await page.reload();
    expect(await htmlLang(page)).toBe('de');
    await expect(
      page
        .getByRole('navigation', { name: 'Hauptnavigation' })
        .getByRole('link', { name: 'Fortschritt' }),
    ).toBeVisible();

    // In-app navigation keeps the language.
    await page
      .getByRole('navigation', { name: 'Hauptnavigation' })
      .getByRole('link', { name: 'Fortschritt' })
      .click();
    await expect(page.getByRole('heading', { name: 'Ein klarer Anfang.' })).toBeVisible();
    expect(await htmlLang(page)).toBe('de');
  });

  test('the browser cannot machine-translate the page', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('meta[name="google"]')).toHaveAttribute('content', 'notranslate');
    await expect(page.locator('html')).toHaveAttribute('translate', 'no');
    await expect(page.locator('#app')).toHaveClass(/notranslate/);
  });

  test('the interface language is independent of the learning language', async ({
    page,
    request,
  }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'mixed');
    await logIn(page, username, learnerPassword);

    // A Spanish interface with a German prompt keeps the prompt in German and
    // marks it as German for assistive technology.
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await page.getByLabel('App language').selectOption('es');
    await page
      .getByRole('navigation', { name: 'Navegación principal' })
      .getByRole('link', { name: 'Practicar' })
      .click();
    await page.getByRole('radio', { name: 'Alemán → Inglés' }).check();
    await page.getByRole('button', { name: 'Empezar a practicar' }).click();

    const prompt = page.getByTestId('practice-prompt');
    await expect(prompt).toBeVisible();
    expect(await prompt.getAttribute('lang')).toBe('de');
    expect(await htmlLang(page)).toBe('es');
  });
});
