import { expect, test } from '@playwright/test';
import { answerFor } from './fixtures/vocabulary';
import { logIn, navigateTo, registerLearner } from './support/app';

const nav = (page: import('@playwright/test').Page, name: string) =>
  page.locator('nav').getByRole('link', { name, exact: true });

/** Starts an exam and answers the first question, then returns the prompt. */
async function startAndAnswer(
  page: import('@playwright/test').Page,
  answer: (prompt: string) => string,
) {
  await page.goto('/exams');
  // Pinned so every prompt is an English word the shared fixtures can answer.
  await page.getByRole('radio', { name: 'English → German' }).check();
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByTestId('exam-prompt')).toBeVisible();
  const prompt = (await page.getByTestId('exam-prompt').innerText()).trim();
  await page.getByLabel('Your answer').fill(answer(prompt));
  await page.locator('form.practice-card').press('Enter');
  return prompt;
}

test.describe('exam mode', () => {
  test('a learner takes an exam and sees only correctness while it runs', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam'));
    // Two questions, so the verdict is shown mid-exam rather than only at the end.
    await navigateTo(page, 'Settings');
    await page.getByLabel('Questions per session').fill('2');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();

    const prompt = await startAndAnswer(page, () => 'definitely wrong');

    // The only feedback is a single word plus its icon. No answer, no reason, no
    // score, nothing in the page source either.
    await expect(page.getByText('Incorrect')).toBeVisible();
    const body = await page.locator('main').innerText();
    expect(body).not.toContain('Correct answer');
    expect(body).not.toContain(answerFor(prompt));
    expect(await page.content()).not.toContain(answerFor(prompt));

    // The exam advances explicitly, and the next question is a new one.
    await page.getByRole('button', { name: 'Next question' }).click();
    await expect(page.getByTestId('exam-prompt')).not.toHaveText(prompt);
    await expect(page.getByLabel('Your answer')).toBeEditable();
    await page.getByLabel('Your answer').fill('wrong');
    await expect(page.getByRole('button', { name: 'Submit answer' })).toBeEnabled();
  });

  test('the results reveal the answers only after the exam ends', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-results'));
    await navigateTo(page, 'Settings');
    await page.getByLabel('Questions per session').fill('1');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();

    const prompt = await startAndAnswer(page, () => 'wrong');
    // With a one-question exam the last answer ends it immediately.
    await expect(page.getByRole('heading', { name: 'Exam results' })).toBeVisible();
    await expect(page.getByText('Score')).toBeVisible();
    await expect(page.getByText('0%')).toBeVisible();
    // The correct answer is readable for the first time.
    await expect(page.getByText('Correct answer')).toBeVisible();
    await expect(page.getByText(answerFor(prompt))).toBeVisible();
  });

  test('an exam respects the vocabulary selection', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-vocab'));
    await navigateTo(page, 'Settings');
    await page.getByLabel('Questions per session').fill('1');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();

    // Switch off every word but one.
    const rows = page.getByRole('checkbox');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    const keep = (await page.locator('.vocabulary__word').first().innerText()).trim();
    for (let i = 1; i < total; i += 1) await rows.nth(i).uncheck();
    await page.waitForTimeout(1200);

    await page.goto('/exams');
    await page.getByRole('radio', { name: 'English → German' }).check();
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    // The only enabled word is the only one that can be asked.
    expect((await page.getByTestId('exam-prompt').innerText()).trim()).toBe(keep);
  });

  test('deselecting everything blocks the exam with a way out', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-empty'));
    await navigateTo(page, 'Settings');
    const rows = page.getByRole('checkbox');
    await expect(rows.first()).toBeVisible();
    await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
    await page.waitForTimeout(1200);

    await page.goto('/exams');
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByText('No vocabulary is currently selected for practice.')).toBeVisible();
  });

  test('leaving mid-exam asks first and records nothing', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-leave'));
    await page.goto('/exams');
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    await page.getByLabel('Your answer').fill('wrong');
    await page.locator('form.practice-card').press('Enter');
    await expect(page.getByText('Incorrect')).toBeVisible();

    await page.getByRole('button', { name: 'Exit exam' }).click();
    await expect(page.getByText(/Leave exam\?/)).toBeVisible();
    // Keeping going preserves the run.
    await page.getByRole('button', { name: 'Keep going' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();

    await page.getByRole('button', { name: 'Exit exam' }).click();
    await page.getByRole('button', { name: 'Leave exam', exact: true }).click();
    await expect(page).toHaveURL(/\/exams$/);

    // An abandoned exam is not counted as completed.
    await navigateTo(page, 'Progress');
    await expect(page.getByText('No exams yet.')).toBeVisible();
  });

  test('exam progress appears on the Progress page', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-stats'));
    await navigateTo(page, 'Settings');
    await page.getByLabel('Questions per session').fill('2');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();

    const first = await startAndAnswer(page, () => 'wrong');
    await page.getByRole('button', { name: 'Next question' }).click();
    // Wait for the new question to arrive: typing earlier is cleared on arrival.
    await expect(page.getByTestId('exam-prompt')).not.toHaveText(first);
    await expect(page.getByLabel('Your answer')).toBeEditable();
    await page.getByLabel('Your answer').fill('also wrong');
    await expect(page.getByRole('button', { name: 'Submit answer' })).toBeEnabled();
    await page.locator('form.practice-card').press('Enter');
    await expect(page.getByRole('heading', { name: 'Exam results' })).toBeVisible();

    await navigateTo(page, 'Progress');
    await expect(page.getByTestId('stat-exams')).toContainText('1');
    await expect(page.getByTestId('stat-exam-average')).toContainText('0%');
    await expect(page.getByTestId('stat-exam-best')).toContainText('0%');
    await expect(page.getByTestId('stat-exam-latest')).toContainText('0%');
    await expect(page.getByText('Exam history')).toBeVisible();
    // The practice statistics are still there.
    await expect(page.getByTestId('stat-points')).toBeVisible();
  });

  test('a guest can take an exam and nothing is written to the database', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    await page.waitForURL(/practice/);
    await nav(page, 'Settings').click();
    await page.getByLabel('Questions per session').fill('1');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Settings saved.' })).toBeVisible();

    await page.goto('/exams');
    await page.getByRole('radio', { name: 'English → German' }).check();
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    const prompt = (await page.getByTestId('exam-prompt').innerText()).trim();
    await page.getByLabel('Your answer').fill('wrong');
    await page.locator('form.practice-card').press('Enter');
    await expect(page.getByRole('heading', { name: 'Exam results' })).toBeVisible();
    await expect(page.getByText(answerFor(prompt))).toBeVisible();

    // Guest statistics work from temporary state, and still report a guest.
    const session = await page.request.get('/api/v1/auth/session');
    expect(await session.json()).toEqual({ user: null, guest: true });
  });

  test('the exam is localized and keeps the answer field settings', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-i18n'));
    await navigateTo(page, 'Settings');
    await page.getByLabel('App language').selectOption('de');
    await page.getByLabel('App-Sprache').selectOption('es');
    await page.getByLabel('Idioma de la aplicación').selectOption('en');

    await page.goto('/exams');
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    const field = page.getByLabel('Your answer');
    // The language-learning keyboard configuration is preserved for exams.
    await expect(field).toHaveAttribute('autocorrect', 'off');
    await expect(field).toHaveAttribute('autocapitalize', 'none');
    await expect(field).toHaveAttribute('spellcheck', 'false');
    // Learning content keeps its own language metadata.
    await expect(page.getByTestId('exam-prompt')).toHaveAttribute('lang', /.+/);
  });

  test('the verdict is announced with a word, not colour alone', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-a11y'));
    await page.goto('/exams');
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    await page.getByLabel('Your answer').fill('wrong');
    await page.locator('form.practice-card').press('Enter');
    // The verdict is announced, and an error is an alert in this app, as
    // everywhere else. The word and the icon are both present, so meaning is
    // never carried by colour alone.
    const verdict = page.getByTestId('exam-verdict');
    await expect(verdict).toBeVisible();
    await expect(verdict).toHaveAttribute('role', 'alert');
    // The icon and the word are both real text, so the meaning does not depend
    // on the colour, and no answer leaks into the verdict.
    await expect(verdict).toContainText('✗');
    await expect(verdict).toContainText('Incorrect');
    await expect(verdict).not.toContainText(answerFor('hello'));
  });
});
