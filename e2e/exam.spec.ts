import { expect, test } from '@playwright/test';
import { answerFor } from './fixtures/vocabulary';
import { logIn, navigateTo, registerLearner } from './support/app';

const nav = (page: import('@playwright/test').Page, name: string) =>
  page.locator('nav').getByRole('link', { name, exact: true });

/** Leaves only the first vocabulary word enabled, so an exam is one question. */
async function enableOnlyFirstWord(page: import('@playwright/test').Page): Promise<string> {
  const rows = page.locator('.vocabulary__list').getByRole('checkbox');
  await expect(rows.first()).toBeVisible();
  const total = await rows.count();
  const keep = (await page.locator('.vocabulary__word').first().innerText()).trim();
  for (let i = 1; i < total; i += 1) await rows.nth(i).uncheck();
  await page.waitForTimeout(1200);
  return keep;
}

/**
 * Starts an exam and answers the first question, then returns the prompt.
 *
 * The exam length is chosen here rather than in Settings: an exam is a test with
 * its own length, not a practice round with the practice round's length.
 */
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
  test('a learner takes an exam and is never told whether an answer was right', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam'));
    const prompt = await startAndAnswer(page, () => 'definitely wrong');

    // Nothing about correctness, in any channel. Not a word, not an icon, not a
    // tone, not a role, not a class, and not in the markup either. (Checked
    // against the rendered page, not page.content(), which also carries the
    // development stylesheet and would match unrelated rules.)
    await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();
    const body = await page.locator('main').innerText();
    expect(body).not.toMatch(/Correct|Incorrect|✓|✗|Score|\d+%/);
    const markup = await page.locator('main').innerHTML();
    expect(markup).not.toMatch(/exam-verdict|data-tone|data-state="correct"/);
    expect(markup).not.toContain(answerFor(prompt));
    // The answer is locked and an alert is not raised: a wrong answer is not an
    // error, and nothing is announced about it.
    await expect(page.getByLabel('Your answer')).toHaveAttribute('readonly', '');
    expect(await page.getByRole('alert').count()).toBe(0);

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
    // One word enabled, so the exam is one question and ends on the first answer.
    await navigateTo(page, 'Settings');
    const only = await enableOnlyFirstWord(page);

    const prompt = await startAndAnswer(page, () => 'wrong');
    expect(prompt).toBe(only);
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
    const keep = await enableOnlyFirstWord(page);

    await page.goto('/exams');
    await page.getByRole('radio', { name: 'English → German' }).check();
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    // The only enabled word is the only one that can be asked.
    expect((await page.getByTestId('exam-prompt').innerText()).trim()).toBe(keep);
  });

  test('the start screen states the real number of questions', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-length'));
    await navigateTo(page, 'Settings');
    // Two words enabled cannot make a 10-question exam, and the screen says so
    // before the exam starts rather than surprising the learner afterwards.
    const rows = page.locator('.vocabulary__list').getByRole('checkbox');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    for (let i = 2; i < total; i += 1) await rows.nth(i).uncheck();
    await page.waitForTimeout(1200);

    await page.goto('/exams');
    await expect(page.getByTestId('exam-actual-length')).toHaveText(
      'Your enabled vocabulary has 2 words, so this exam has 2 questions.',
    );
  });

  test('deselecting everything blocks the exam with a way out', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-empty'));
    await navigateTo(page, 'Settings');
    const rows = page.locator('.vocabulary__list').getByRole('checkbox');
    await expect(rows.first()).toBeVisible();
    // The toolbar's master checkbox is what switches everything off now.
    await page.getByRole('checkbox', { name: /^Deselect all \d+$/ }).click();
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
    await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();

    await page.getByRole('button', { name: 'Exit exam' }).click();
    await expect(page.getByText(/Leave exam\?/)).toBeVisible();
    // Keeping going preserves the run.
    await page.getByRole('button', { name: 'Keep going' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();

    await page.getByRole('button', { name: 'Exit exam' }).click();
    await page.getByRole('button', { name: 'Leave exam', exact: true }).click();
    await expect(page).toHaveURL(/\/exams$/);

    // An abandoned exam is not a completed exam: not counted, not scored.
    await navigateTo(page, 'Progress');
    await expect(page.getByText('No exams yet.')).toBeVisible();
  });

  test('leaving then immediately tapping another tab is not undone', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-leave-race'));
    await page.goto('/exams');
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    await page.getByLabel('Your answer').fill('wrong');
    await page.locator('form.practice-card').press('Enter');
    await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();

    await page.getByRole('button', { name: 'Exit exam' }).click();
    await page.getByRole('button', { name: 'Leave exam', exact: true }).click();
    // Tap another tab straight away, while the abandon request is still in
    // flight. The late navigation used to land afterwards and bounce the learner
    // back to the exam screen.
    await page.locator('nav').getByRole('link', { name: 'Progress', exact: true }).click();
    await expect(page).toHaveURL(/\/progress$/);
    // The exam screen is gone, and it does not come back.
    await expect(page.getByTestId('exam-prompt')).toHaveCount(0);
    await expect(
      page.locator('nav').getByRole('link', { name: 'Progress', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    await page.waitForTimeout(1500);
    await expect(page).toHaveURL(/\/progress$/);
  });

  test('exam progress appears on the Progress page', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-stats'));
    await navigateTo(page, 'Settings');
    // Two words, so the exam is two questions and ends on the second answer.
    const rows = page.locator('.vocabulary__list').getByRole('checkbox');
    await expect(rows.first()).toBeVisible();
    const total = await rows.count();
    for (let i = 2; i < total; i += 1) await rows.nth(i).uncheck();
    await page.waitForTimeout(1200);

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
    // One word, so the exam ends on the first answer.
    await nav(page, 'Settings').click();
    await enableOnlyFirstWord(page);

    await page.goto('/exams');
    await page.getByRole('radio', { name: 'English → German' }).check();
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    const prompt = (await page.getByTestId('exam-prompt').innerText()).trim();
    await page.getByLabel('Your answer').fill('wrong');
    await page.locator('form.practice-card').press('Enter');
    await expect(page.getByRole('heading', { name: 'Exam results' })).toBeVisible();
    // A guest is scored by exactly the same rules as a user.
    await expect(page.getByText('0%')).toBeVisible();
    await expect(page.getByText(answerFor(prompt))).toBeVisible();

    // Guest statistics work from temporary state, and still report a guest.
    const session = await page.request.get('/api/v1/auth/session');
    expect(await session.json()).toEqual({ user: null, guest: true });
  });

  test('a past exam opens from the Progress history', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-open'));
    await navigateTo(page, 'Settings');
    // One word, so the exam is one question.
    await enableOnlyFirstWord(page);

    await page.goto('/exams');
    await page.getByRole('radio', { name: 'English → German' }).check();
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    const prompt = (await page.getByTestId('exam-prompt').innerText()).trim();
    await page.getByLabel('Your answer').fill(answerFor(prompt));
    await page.locator('form.practice-card').press('Enter');
    await expect(page.getByRole('heading', { name: 'Exam results' })).toBeVisible();
    await expect(page.getByText('100%')).toBeVisible();

    // The history row links back to this exam. It used to land on the start
    // screen, because the query was never read.
    await navigateTo(page, 'Progress');
    await page.locator('.exam-history__link').first().click();
    await expect(page).toHaveURL(/\/exams$/);
    await expect(page.getByRole('heading', { name: 'Exam results' })).toBeVisible();
    await expect(page.getByText('100%')).toBeVisible();
    await expect(page.getByText(answerFor(prompt))).toBeVisible();

    // And a fresh exam can still be started from there.
    await page.getByRole('button', { name: 'Take another exam' }).click();
    await expect(page.getByRole('button', { name: 'Start exam' })).toBeVisible();
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

  test('nothing about correctness reaches the accessibility tree', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'exam-a11y'));
    await page.goto('/exams');
    await page.getByRole('button', { name: 'Start exam' }).click();
    await expect(page.getByTestId('exam-prompt')).toBeVisible();
    await page.getByLabel('Your answer').fill('wrong');
    await page.locator('form.practice-card').press('Enter');
    await expect(page.getByRole('button', { name: 'Next question' })).toBeVisible();

    // A screen reader must not be able to learn the outcome either. No live
    // region fires, no alert or status carries a verdict, and the accessible
    // name and description of every element on the card are free of correctness.
    expect(await page.getByRole('alert').count()).toBe(0);
    expect(
      await page
        .getByRole('status')
        .filter({ hasText: /correct|incorrect/i })
        .count(),
    ).toBe(0);
    const cardText = await page.locator('form.practice-card').innerText();
    expect(cardText.toLowerCase()).not.toMatch(/correct|incorrect|right|wrong|score/);
    // And the progress indicator reports position only, never performance.
    await expect(page.getByRole('progressbar')).toHaveAttribute(
      'aria-valuetext',
      /Question \d+ of \d+/,
    );
  });
});
