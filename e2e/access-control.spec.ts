import { expect, test } from '@playwright/test';
import { logIn, registerLearner } from './support/app';
import { learnerPassword } from './support/environment';

const importPayload = { content: '[{"english":"forbidden","german":"verboten"}]', confirm: true };

test.describe('unauthorized access', () => {
  test('an anonymous visitor sees only the login screen and the API refuses data', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);

    for (const url of ['/api/v1/dashboard', '/api/v1/settings', '/api/v1/practice/question']) {
      expect((await page.request.get(url)).status(), url).toBe(401);
    }
    expect(
      (
        await page.request.post('/api/v1/admin/vocabulary/import', { data: importPayload })
      ).status(),
    ).toBe(401);
  });

  test('a signed-out visit makes no failed API request', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', (response) => {
      if (response.url().includes('/api/') && response.status() >= 400) {
        failed.push(`${response.status()} ${response.url()}`);
      }
    });
    await page.goto('/practice');
    await expect(page).toHaveURL(/\/login\?redirect=\/practice$/);
    await page.getByRole('link', { name: 'Need an account?' }).click();
    await expect(page.getByRole('button', { name: 'Create account' })).toBeVisible();
    expect(failed).toEqual([]);
  });

  test('a learner has no administrator tools and is refused by the API', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'no-admin'));
    await expect(page.getByRole('link', { name: 'Import vocabulary' })).toHaveCount(0);
    await page.goto('/admin/import');
    await expect(page).toHaveURL(/\/practice$/);

    expect((await page.request.get('/api/v1/admin/vocabulary/imports')).status()).toBe(403);
    expect(
      (
        await page.request.post('/api/v1/admin/vocabulary/preview', { data: importPayload })
      ).status(),
    ).toBe(403);
    expect(
      (
        await page.request.post('/api/v1/admin/vocabulary/import', { data: importPayload })
      ).status(),
    ).toBe(403);
  });

  test('a deep link requires login and returns to the page afterwards', async ({
    page,
    request,
  }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'deep-link');
    await page.goto('/settings');
    await expect(page).toHaveURL(/\/login\?redirect=\/settings$/);
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(learnerPassword);
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(page.getByRole('heading', { name: 'Set your rhythm.' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Set your rhythm.' })).toBeVisible();
  });

  test('unknown pages show a not-found page', async ({ page }) => {
    await page.goto('/no/such/page');
    await expect(page.getByRole('heading', { name: 'Page not found.' })).toBeVisible();
    await page.getByRole('link', { name: 'Go to login' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('logging out ends the session in the UI and on the server', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'logout'));
    expect((await page.request.get('/api/v1/dashboard')).status()).toBe(200);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
    expect((await page.request.get('/api/v1/dashboard')).status()).toBe(401);
  });
});
