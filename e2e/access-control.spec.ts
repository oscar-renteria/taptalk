import { expect, test } from '@playwright/test';
import { logIn, registerLearner } from './support/app';

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

  test('a learner has no administrator tools and is refused by the API', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'no-admin'));
    await expect(page.getByRole('button', { name: 'Import vocabulary' })).toHaveCount(0);

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
