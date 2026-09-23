import { expect, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import { learnerPassword } from './environment';

export function uniqueUsername(testInfo: TestInfo, label: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${testInfo.project.name}-${label}-${suffix}`;
}

// Creates an account through the API so journeys that are not about registration start faster.
export async function registerLearner(
  request: APIRequestContext,
  testInfo: TestInfo,
  label: string,
): Promise<string> {
  const username = uniqueUsername(testInfo, label);
  const response = await request.post('/api/v1/auth/register', {
    data: { username, password: learnerPassword },
  });
  expect(response.status()).toBe(201);
  return username;
}

export async function logIn(page: Page, username: string, password = learnerPassword) {
  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
}

export function navigateTo(
  page: Page,
  tab: 'Practice' | 'Progress' | 'Settings' | 'Import vocabulary',
) {
  return page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('button', { name: tab })
    .click();
}
