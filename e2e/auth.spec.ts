import { expect, test } from '@playwright/test';
import { logIn, registerLearner, uniqueUsername } from './support/app';
import { learnerPassword } from './support/environment';

test.describe('registration and login', () => {
  test('a new learner registers and lands on the practice desk', async ({ page }, testInfo) => {
    const username = uniqueUsername(testInfo, 'register');
    await page.goto('/');
    await page.getByRole('link', { name: 'Need an account?' }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(learnerPassword);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByText(username, { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ready when you are.' })).toBeVisible();
  });

  test('registering an existing username is rejected', async ({ page, request }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'taken');
    await page.goto('/');
    await page.getByRole('link', { name: 'Need an account?' }).click();
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill(learnerPassword);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page.getByText('This username is taken. Try another one.')).toBeVisible();
    await expect(page.getByLabel('Username')).toBeFocused();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });

  test('a weak password is explained before anything is sent', async ({ page }, testInfo) => {
    const username = uniqueUsername(testInfo, 'weak');
    await page.goto('/register');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill('12345678');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(page.getByLabel('Password')).toHaveAttribute('type', 'text');
    await page.getByLabel('Password').press('Enter');

    await expect(page.getByText('Password is too common.', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Password')).toBeFocused();
    await expect(page).toHaveURL(/\/register$/);
  });

  test('an existing learner logs in', async ({ page, request }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'login');
    await logIn(page, username);
    await expect(page.getByText(username, { exact: true })).toBeVisible();
  });

  test('reloading the page keeps the learner signed in', async ({ page, request }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'reload');
    await logIn(page, username);
    await page.reload();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
    await expect(page.getByText(username, { exact: true })).toBeVisible();
  });

  test('a wrong password shows an error and keeps the user logged out', async ({
    page,
    request,
  }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'wrong-password');
    await page.goto('/');
    await page.getByLabel('Username').fill(username);
    await page.getByLabel('Password').fill('not-the-right-password');
    await page.getByRole('button', { name: 'Log in' }).click();

    await expect(page.getByRole('alert')).toHaveText('Username or password is invalid.');
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  });
});
