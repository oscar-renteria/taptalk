import { expect, test, type Locator, type Page } from '@playwright/test';
import { logIn, navigateTo, registerLearner } from './support/app';
import { administrator } from './support/environment';

async function expectNoHorizontalOverflow(page: Page, state: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.max(root.scrollWidth, document.body.scrollWidth) - root.clientWidth;
  });
  expect(overflow, `${state} must not scroll horizontally`).toBeLessThanOrEqual(1);
}

async function expectInsideViewport(
  page: Page,
  locator: Locator,
  axis: 'horizontal' | 'vertical',
): Promise<void> {
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  await expect
    .poll(async () => {
      const box = await locator.boundingBox();
      if (!box || !viewport) return false;
      return axis === 'horizontal'
        ? box.x >= -1 && box.x + box.width <= viewport.width + 1
        : box.y >= -1 && box.y + box.height <= viewport.height + 1;
    })
    .toBe(true);
}

async function expectTouchTargets(page: Page, state: string): Promise<void> {
  const undersized = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a, button, input, select')]
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 44 || box.height < 44)
      .map(
        ({ element, box }) =>
          `${element.tagName.toLowerCase()} "${(element.textContent || element.id).trim()}" ${Math.round(box.width)}x${Math.round(box.height)}`,
      ),
  );
  expect(undersized, `${state} touch targets`).toEqual([]);
}

async function expectPageFits(page: Page, state: string): Promise<void> {
  await expectNoHorizontalOverflow(page, state);
  await expectTouchTargets(page, state);
}

test.describe('responsive layout', () => {
  test('account errors remain readable and contained', async ({ page }) => {
    await page.route('**/api/v1/auth/login', async (route) => {
      await route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'INVALID_CREDENTIALS', message: `Could not sign in: ${'x'.repeat(180)}` },
        }),
      });
    });
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto('/login');
    await page.getByLabel('Username').fill('learner');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();

    const error = page.getByRole('alert');
    await expect(error).toBeVisible();
    await expectInsideViewport(page, error, 'horizontal');
    await expectPageFits(page, 'login error');

    await page.goto('/register');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('#username-error')).toBeVisible();
    await expect(page.locator('#password-error')).toBeVisible();
    await expectPageFits(page, 'registration errors');
  });

  test('learner flows survive narrow, keyboard-sized and rotated viewports', async ({
    page,
    request,
  }, testInfo) => {
    const originalViewport = page.viewportSize();
    expect(originalViewport).not.toBeNull();
    await logIn(page, await registerLearner(request, testInfo, 'responsive'));
    await expectPageFits(page, 'practice start');

    const longPrompt =
      'Pneumonoultramicroscopicsilicovolcanoconiosis-and-an-equally-long-vocabulary-phrase';
    await page.route(/\/api\/v1\/practice\/question\?/, async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify({
          question: {
            vocabularyEntryId: 'responsive-entry',
            direction: 'english-to-german',
            prompt: longPrompt,
            phonetics: null,
          },
        }),
      });
    });
    await page.getByLabel('Practice direction').selectOption('english-to-german');
    await page.getByRole('button', { name: 'Start practice' }).click();
    const answer = page.getByLabel('Your answer');
    await expect(answer).toBeFocused();
    await expect(page.getByTestId('practice-prompt')).toHaveText(longPrompt);

    await page.setViewportSize({ width: 320, height: 360 });
    await expectNoHorizontalOverflow(page, 'narrow practice question');
    await expectInsideViewport(page, page.getByTestId('practice-prompt'), 'horizontal');
    await answer.blur();
    await answer.focus();
    await expectInsideViewport(page, answer, 'vertical');
    await expect(answer).toHaveAttribute('enterkeyhint', 'done');
    await expectPageFits(page, 'keyboard-sized practice question');

    const rotatedViewport =
      testInfo.project.name === 'tablet'
        ? { width: 1180, height: 820 }
        : { width: 915, height: 412 };
    await page.setViewportSize(rotatedViewport);
    await answer.blur();
    await answer.focus();
    await expectNoHorizontalOverflow(page, 'rotated practice question');
    await expectInsideViewport(page, answer, 'vertical');
    await expectPageFits(page, 'rotated practice question');

    await page.setViewportSize(originalViewport!);
    await navigateTo(page, 'Progress');
    await expect(page.getByTestId('stat-attempts')).toBeVisible();
    await expectPageFits(page, 'progress');
    const statRows = await page
      .locator('.stat')
      .evaluateAll(
        (tiles) => new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().top))).size,
      );
    expect(statRows, 'dashboard columns').toBe(testInfo.project.name === 'tablet' ? 1 : 2);

    await navigateTo(page, 'Settings');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expectPageFits(page, 'settings confirmation');
  });

  test('administrator content wraps at a narrow width', async ({ page }) => {
    await logIn(page, administrator.username, administrator.password);
    await navigateTo(page, 'Import vocabulary');
    await page.setViewportSize({ width: 320, height: 640 });
    const sourceName = `${'vocabulary'.repeat(19)}.json`;
    await page.getByLabel('Vocabulary JSON file').setInputFiles({
      name: sourceName,
      mimeType: 'application/json',
      buffer: Buffer.from('not valid JSON'),
    });
    const selectedFile = page.getByText(`Selected: ${sourceName}`, { exact: true });
    await expect(selectedFile).toContainText(sourceName);
    await expectInsideViewport(page, selectedFile, 'horizontal');
    await expectPageFits(page, 'selected import file');

    await page.getByRole('button', { name: 'Preview import' }).click();
    await expect(page.getByText('1 invalid records')).toBeVisible();
    await expectPageFits(page, 'import error preview');
  });
});
