import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { answerFor } from './fixtures/vocabulary';
import { logIn, navigateTo, registerLearner, uniqueUsername } from './support/app';
import { administrator } from './support/environment';

// Automated WCAG 2.2 AA checks (axe-core) for every core screen and state, plus measurable checks
// axe cannot do: touch targets, reflow with enlarged text, reduced motion, non-colour feedback.

async function expectNoViolations(page: Page, state: string): Promise<void> {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'])
    .analyze();
  const summary = results.violations.map((violation) => ({
    rule: violation.id,
    impact: violation.impact,
    targets: violation.nodes.map((node) => node.target.join(' ')),
  }));
  expect(summary, `axe violations in state "${state}"`).toEqual([]);
}

async function startQuestion(page: Page): Promise<string> {
  await page.getByLabel('Practice direction').selectOption('english-to-german');
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByRole('button', { name: 'Submit answer' })).toBeEnabled();
  return (await page.getByTestId('practice-prompt').innerText()).trim();
}

test.describe('automated accessibility audit', () => {
  test('account screens', async ({ page }, testInfo) => {
    await page.goto('/login');
    await expectNoViolations(page, 'login');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.locator('#username-error')).toBeVisible();
    await expectNoViolations(page, 'login with field errors');

    await page.goto('/register');
    await page.getByLabel('Username').fill(uniqueUsername(testInfo, 'a11y'));
    await page.getByLabel('Password').fill('password');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.locator('#password-error')).toBeVisible();
    await expectNoViolations(page, 'registration with field errors');

    await page.goto('/login');
    await page.getByLabel('Username').fill('nobody-here');
    await page.getByLabel('Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Log in' }).click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expectNoViolations(page, 'login with form error');

    await page.goto('/no/such/page');
    await expectNoViolations(page, 'not found');
  });

  test('practice flow', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'a11y-practice'));
    await expectNoViolations(page, 'practice start');

    const prompt = await startQuestion(page);
    await expectNoViolations(page, 'question');
    await page.getByLabel('Your answer').fill(answerFor(prompt));
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText('Correct.')).toBeVisible();
    await expectNoViolations(page, 'correct feedback');

    await page.getByRole('button', { name: 'Next question' }).click();
    await expect(page.getByRole('button', { name: 'Submit answer' })).toBeEnabled();
    await page.getByLabel('Your answer').fill('definitely wrong');
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText('Not quite.')).toBeVisible();
    await expectNoViolations(page, 'wrong-answer feedback');

    await page.getByRole('button', { name: 'End session' }).click();
    await expect(page.getByRole('heading', { name: 'Session ended early.' })).toBeVisible();
    await expectNoViolations(page, 'session summary');
  });

  test('progress and settings', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'a11y-views'));
    await navigateTo(page, 'Progress');
    await expect(page.getByTestId('stat-points')).toBeVisible();
    await expectNoViolations(page, 'progress');

    await navigateTo(page, 'Settings');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved.')).toBeVisible();
    await expectNoViolations(page, 'settings saved');
  });

  test('administrator import', async ({ page }) => {
    await logIn(page, administrator.username, administrator.password);
    await navigateTo(page, 'Import vocabulary');
    await expect(page.getByRole('heading', { name: 'Import history' })).toBeVisible();
    await expectNoViolations(page, 'import');
    await page.getByLabel('Vocabulary JSON file').setInputFiles({
      name: 'a11y.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ english: '', german: '' }])),
    });
    await page.getByRole('button', { name: 'Preview import' }).click();
    await expect(page.getByText('1 invalid records')).toBeVisible();
    await expectNoViolations(page, 'import preview with errors');
  });
});

async function reachSummary(page: Page): Promise<void> {
  const prompt = await startQuestion(page);
  await page.getByLabel('Your answer').fill(answerFor(prompt));
  await page.getByRole('button', { name: 'Submit answer' }).click();
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByRole('heading', { name: 'Session ended early.' })).toBeVisible();
}

async function undersizedTargets(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('a, button, input, select, [tabindex="0"]')]
      .filter((element) => element.offsetParent !== null)
      .map((element) => ({ element, box: element.getBoundingClientRect() }))
      .filter(({ box }) => box.width < 44 || box.height < 44)
      .map(
        ({ element, box }) =>
          `${element.tagName.toLowerCase()} "${(element.textContent || element.id).trim()}" ${Math.round(box.width)}x${Math.round(box.height)}`,
      ),
  );
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test.describe('measurable accessibility requirements', () => {
  test('touch targets are at least 44 by 44 CSS pixels', async ({ page, request }, testInfo) => {
    await page.goto('/login');
    expect(await undersizedTargets(page), 'login').toEqual([]);
    await logIn(page, await registerLearner(request, testInfo, 'a11y-targets'));
    await startQuestion(page);
    expect(await undersizedTargets(page), 'question').toEqual([]);
    await page.getByRole('button', { name: 'End session' }).click();
    expect(await undersizedTargets(page), 'summary').toEqual([]);
    await navigateTo(page, 'Settings');
    await expect(page.getByRole('button', { name: 'Save settings' })).toBeEnabled();
    expect(await undersizedTargets(page), 'settings').toEqual([]);
  });

  test('content reflows at 320px with text enlarged to 200%', async ({
    browser,
    request,
  }, testInfo) => {
    const context = await browser.newContext({
      viewport: { width: 320, height: 640 },
      baseURL: testInfo.project.use.baseURL ?? '',
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        document.documentElement.style.fontSize = '200%';
      });
    });
    await page.goto('/register');
    expect(await horizontalOverflow(page), 'register').toBeLessThanOrEqual(0);
    // The separate `request` context keeps the new page signed out until it logs in.
    await logIn(page, await registerLearner(request, testInfo, 'a11y-zoom'));
    expect(await horizontalOverflow(page), 'practice').toBeLessThanOrEqual(0);
    await reachSummary(page);
    expect(await horizontalOverflow(page), 'summary').toBeLessThanOrEqual(0);
    for (const tab of ['Progress', 'Settings'] as const) {
      await navigateTo(page, tab);
      await expect(page.locator('h1')).toBeVisible();
      expect(await horizontalOverflow(page), tab).toBeLessThanOrEqual(0);
    }
    await context.close();
  });

  test('motion is removed when the user prefers reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/login');
    const durations = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'spinner';
      const bar = document.createElement('div');
      bar.className = 'progress__bar';
      document.body.append(probe, bar);
      return [getComputedStyle(probe).animationDuration, getComputedStyle(bar).transitionDuration];
    });
    for (const duration of durations) expect(parseFloat(duration)).toBeLessThanOrEqual(0.00001);
  });

  test('feedback tone is conveyed by an icon and text, not colour alone', async ({ page }) => {
    await page.goto('/login');
    const icons = await page.evaluate(() =>
      ['success', 'warning', 'error', 'info'].map((tone) => {
        const probe = document.createElement('p');
        probe.className = 'status';
        probe.dataset.tone = tone;
        document.body.append(probe);
        return getComputedStyle(probe, '::before').content;
      }),
    );
    expect(icons.every((content) => content !== 'none' && content !== 'normal')).toBe(true);
    expect(new Set(icons).size).toBe(4);
  });

  test('German text is marked as German for assistive technology', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'a11y-lang'));
    await startQuestion(page);
    await expect(page.getByTestId('practice-prompt')).toHaveAttribute('lang', 'en');
    await expect(page.getByLabel('Your answer')).toHaveAttribute('lang', 'de');
    await page.getByRole('button', { name: 'End session' }).click();
    await navigateTo(page, 'Progress');
    await navigateTo(page, 'Practice');
    await page.getByLabel('Practice direction').selectOption('german-to-english');
    await page.getByRole('button', { name: 'Start practice' }).click();
    await expect(page.getByRole('button', { name: 'Submit answer' })).toBeEnabled();
    await expect(page.getByTestId('practice-prompt')).toHaveAttribute('lang', 'de');
    await expect(page.getByLabel('Your answer')).toHaveAttribute('lang', 'en');
  });

  test('the answer field is described by the prompt it answers', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'a11y-describe'));
    const prompt = await startQuestion(page);
    const description = await page.getByLabel('Your answer').evaluate((input) =>
      (input.getAttribute('aria-describedby') ?? '')
        .split(' ')
        .map((id) => document.getElementById(id)?.textContent?.trim())
        .join(' '),
    );
    expect(description).toContain(prompt);
  });

  test('status messages use a live region that exists before the message appears', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'a11y-live'));
    const prompt = await startQuestion(page);
    const region = page.locator('[role="status"][aria-live="polite"]');
    await expect(region).toHaveCount(1);
    await expect(region).toHaveText('');
    await page.getByLabel('Your answer').fill(answerFor(prompt));
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(region).toHaveText('Correct. +10 points.');
  });
});

test.describe('keyboard-only use', () => {
  test('a learner can log in, practise, navigate and log out without a pointer', async ({
    page,
    request,
  }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'a11y-keyboard');
    await page.goto('/login');
    // Wait for the form: while the session is being checked there is nothing to focus yet.
    await expect(page.getByLabel('Username')).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Username')).toBeFocused();
    await page.keyboard.type(username);
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Password')).toBeFocused();
    await page.keyboard.type('e2e-learner-password');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Ready when you are.' })).toBeVisible();

    // The focus ring is visible on keyboard focus.
    await page.getByLabel('Practice direction').focus();
    const outline = await page
      .getByLabel('Practice direction')
      .evaluate((element) => getComputedStyle(element).outlineStyle);
    expect(outline).toBe('solid');
    await page.getByLabel('Practice direction').selectOption('english-to-german');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Start practice' })).toBeFocused();
    await page.keyboard.press('Enter');

    await expect(page.getByLabel('Your answer')).toBeFocused();
    const prompt = (await page.getByTestId('practice-prompt').innerText()).trim();
    await page.keyboard.type(answerFor(prompt));
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Next question' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Your answer')).toBeFocused();

    // Navigating moves focus to the new page's heading so the change is announced.
    await page.getByRole('link', { name: 'Settings' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('heading', { name: 'Set your rhythm.' })).toBeFocused();

    await page.getByRole('button', { name: 'Log out' }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible();
  });
});
