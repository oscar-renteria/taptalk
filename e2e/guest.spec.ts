import { expect, test } from '@playwright/test';
import { answerFor } from './fixtures/vocabulary';
import { navigateTo, uniqueUsername } from './support/app';
import { learnerPassword } from './support/environment';

test.describe('guest mode', () => {
  test('a visitor can continue as a guest and use the app', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByText(/progress is temporary/i)).toBeVisible();

    await page.getByRole('button', { name: 'Continue as Guest' }).click();

    // The guest lands in the app with the same shell a user gets.
    await expect(page).toHaveURL(/\/practice$/);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Progress' }),
    ).toBeVisible();
    // A subtle indicator replaces the username.
    await expect(page.getByText('Guest', { exact: true })).toBeVisible();
    // And the temporary nature of the session is stated.
    await expect(page.getByText('You are using TapTalk as a guest.')).toBeVisible();
  });

  test('a guest can complete a practice round', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    // Mixed would sometimes ask for German, which the shared fixtures do not cover.
    await page.getByRole('radio', { name: 'English → German' }).check();
    await page.getByRole('button', { name: 'Start practice' }).click();

    const answer = page.getByLabel('Your answer');
    await expect(answer).toBeVisible();
    const prompt = (await page.getByTestId('practice-prompt').innerText()).trim();
    await answer.fill(answerFor(prompt));
    await page.locator('form.practice-card').press('Enter');
    // Grading and scoring work exactly as they do for a user.
    await expect(page.getByText('Correct!')).toBeVisible();
  });

  test('a guest reaches progress and settings but not the administrator screen', async ({
    page,
  }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();

    await navigateTo(page, 'Progress');
    await expect(page.getByRole('heading', { name: 'A clear beginning.' })).toBeVisible();
    await navigateTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Set your rhythm.' })).toBeVisible();

    // Administrator tools are not offered and are not reachable by URL.
    await expect(page.getByRole('link', { name: 'Vocabulary' })).toHaveCount(0);
    await page.goto('/admin/import');
    await expect(page).toHaveURL(/\/practice$/);
  });

  test('a guest session survives a reload and in-app navigation', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    await expect(page.getByText('Guest', { exact: true })).toBeVisible();

    await page.reload();
    await expect(page.getByText('Guest', { exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/practice$/);

    await navigateTo(page, 'Progress');
    await expect(page.getByRole('heading', { name: 'A clear beginning.' })).toBeVisible();
  });

  test('ending a guest session returns to the account screen', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    await page.getByRole('button', { name: /Guest session menu/ }).click();
    await page.getByRole('button', { name: 'End guest session' }).click();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Continue as Guest' })).toBeVisible();
  });

  test('a guest is told nothing was saved to an account', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page.getByLabel('Your answer')).toBeVisible();

    // page.request shares the browser context, so it carries the guest cookie.
    // The session endpoint reports a guest with no user: no account was created.
    const session = await page.request.get('/api/v1/auth/session');
    expect(await session.json()).toEqual({ user: null, guest: true });

    // A guest cannot reach account-only or administrator endpoints.
    expect((await page.request.get('/api/v1/auth/me')).status()).toBe(401);
    expect((await page.request.get('/api/v1/admin/vocabulary/imports')).status()).toBe(401);
  });

  test('signing up from a guest session creates a real account', async ({ page }, testInfo) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    await expect(page.getByText('Guest', { exact: true })).toBeVisible();

    // Leaving guest mode, then registering, works as a normal flow.
    await page.getByRole('button', { name: /Guest session menu/ }).click();
    await page.getByRole('button', { name: 'End guest session' }).click();

    const username = uniqueUsername(testInfo, 'from-guest');
    await page.getByRole('link', { name: 'Need an account?' }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(learnerPassword);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/practice$/);
    const session = await page.request.get('/api/v1/auth/session');
    const body = (await session.json()) as { user: { username: string } | null; guest: boolean };
    expect(body.user?.username).toBe(username);
    expect(body.guest).toBe(false);
  });

  test('guest mode is offered in every language', async ({ page }) => {
    await page.goto('/login');
    // The label is itself translated, so it is re-resolved after each switch.
    await page.getByLabel('App language').selectOption('de');
    await expect(page.getByRole('button', { name: 'Als Gast fortfahren' })).toBeVisible();
    await page.getByLabel('App-Sprache').selectOption('es');
    await expect(page.getByRole('button', { name: 'Continuar como invitado' })).toBeVisible();
    await page.getByLabel('Idioma de la aplicación').selectOption('en');
    await expect(page.getByRole('button', { name: 'Continue as Guest' })).toBeVisible();
  });
});
