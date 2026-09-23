import { expect, test, type Page } from '@playwright/test';
import { answerFor } from './fixtures/vocabulary';
import { logIn, navigateTo, registerLearner } from './support/app';

async function setSessionLength(page: Page, questions: number): Promise<void> {
  await navigateTo(page, 'Settings');
  await page.getByLabel('Default direction').selectOption('english-to-german');
  await page.getByLabel('Questions per session').fill(String(questions));
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');
  await navigateTo(page, 'Practice');
}

async function startSession(page: Page): Promise<void> {
  await page.getByLabel('Practice direction').selectOption('english-to-german');
  await page.getByRole('button', { name: 'Start practice' }).click();
}

async function currentPrompt(page: Page, questionNumber: number): Promise<string> {
  await expect(page.getByTestId('session-progress')).toContainText(`Question ${questionNumber} of`);
  await expect(page.getByRole('button', { name: 'Submit answer' })).toBeEnabled();
  return (await page.getByTestId('practice-prompt').innerText()).trim();
}

async function answer(page: Page, submittedAnswer: string): Promise<void> {
  await page.getByLabel('Your answer').fill(submittedAnswer);
  await page.getByRole('button', { name: 'Submit answer' }).click();
}

test.describe('practice journeys', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'practice'));
  });

  test('choosing settings persists the preferences', async ({ page }) => {
    await navigateTo(page, 'Settings');
    await expect(page.getByRole('heading', { name: 'Set your rhythm.' })).toBeVisible();
    // The form is disabled while stored settings load, so these actions wait for it.
    await page.getByLabel('Default direction').selectOption('german-to-english');
    await page.getByLabel('Questions per session').fill('4');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status')).toHaveText('Settings saved.');

    const saved = await page.request.get('/api/v1/settings');
    expect(saved.status()).toBe(200);
    expect((await saved.json()).settings).toMatchObject({
      direction: 'german-to-english',
      sessionLength: 4,
    });

    // Leaving and re-entering the view reloads the values from the server.
    await navigateTo(page, 'Practice');
    await page.getByLabel('Practice direction').selectOption('random');
    await navigateTo(page, 'Settings');
    await expect(page.getByLabel('Default direction')).toHaveValue('german-to-english');
    await expect(page.getByLabel('Questions per session')).toHaveValue('4');
  });

  test('completing a question with the correct answer gives positive feedback', async ({
    page,
  }) => {
    await startSession(page);
    await answer(page, answerFor(await currentPrompt(page, 1)));
    await expect(page.getByRole('status')).toHaveText('Correct. +10 points.');
    await expect(page.getByRole('button', { name: 'Next question' })).toBeFocused();
  });

  test('a wrong answer submitted with Enter explains the correct answer', async ({ page }) => {
    await startSession(page);
    const prompt = await currentPrompt(page, 1);
    await expect(page.getByLabel('Your answer')).toBeFocused();
    await page.keyboard.type('definitely wrong');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('status')).toHaveText(
      `Not quite. The answer is ${answerFor(prompt)}.`,
    );
  });

  test('completing a session shows the session summary', async ({ page }) => {
    await setSessionLength(page, 2);
    await startSession(page);
    await answer(page, answerFor(await currentPrompt(page, 1)));
    await page.getByRole('button', { name: 'Next question' }).click();
    const second = await currentPrompt(page, 2);
    await answer(page, 'definitely wrong');
    await page.getByRole('button', { name: 'See results' }).click();

    await expect(page.getByRole('heading', { name: 'Session complete.' })).toBeFocused();
    await expect(page.getByTestId('summary-questions')).toContainText('2');
    await expect(page.getByTestId('summary-correct')).toContainText('1');
    await expect(page.getByTestId('summary-incorrect')).toContainText('1');
    await expect(page.getByTestId('summary-points')).toContainText('10');
    await expect(page.getByTestId('summary-accuracy')).toContainText('50%');
    await expect(page.getByRole('list', { name: 'Words to practice again' })).toContainText(second);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, 'summary must not scroll horizontally').toBeLessThanOrEqual(0);

    await page.getByRole('button', { name: 'Practice again' }).click();
    await currentPrompt(page, 1);
  });

  test('ending a session early shows a partial summary', async ({ page }) => {
    await startSession(page);
    await answer(page, answerFor(await currentPrompt(page, 1)));
    await page.getByRole('button', { name: 'End session' }).click();

    await expect(page.getByRole('heading', { name: 'Session ended early.' })).toBeVisible();
    await expect(page.getByText('You answered 1 of 10 questions.')).toBeVisible();
    await page.getByRole('button', { name: 'Go to progress' }).click();
    await expect(page.getByRole('heading', { name: 'A clear beginning.' })).toBeVisible();
  });

  test('the dashboard reflects completed practice', async ({ page }) => {
    await navigateTo(page, 'Progress');
    await expect(
      page.getByText('Complete a practice round to see your learning history here.'),
    ).toBeVisible();
    await expect(page.getByTestId('stat-attempts')).toContainText('0');

    await navigateTo(page, 'Practice');
    await startSession(page);
    await answer(page, answerFor(await currentPrompt(page, 1)));
    await expect(page.getByRole('status')).toHaveText('Correct. +10 points.');
    await page.getByRole('button', { name: 'Next question' }).click();
    await currentPrompt(page, 2);
    await answer(page, 'definitely wrong');
    await expect(page.getByRole('status')).toContainText('Not quite.');

    await navigateTo(page, 'Progress');
    await expect(page.getByTestId('stat-points')).toContainText('10');
    await expect(page.getByTestId('stat-attempts')).toContainText('2');
    await expect(page.getByTestId('stat-accuracy')).toContainText('50%');
  });
});
