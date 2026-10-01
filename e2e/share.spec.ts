import { expect, test, type Page } from '@playwright/test';
import { answerFor } from './fixtures/vocabulary';
import { logIn, registerLearner } from './support/app';

/**
 * Share results and referral links.
 *
 * Covers the two supported result types, an anonymous recipient, and a referral
 * surviving the hop from a shared card to a registration.
 */

/**
 * Leaves only the first vocabulary word enabled and shortens the round.
 *
 * The list lives in Settings; its navigation entry is administrator-only, so the
 * route is used directly. The master checkbox switches every row off in one
 * request rather than one per row, which keeps this helper cheap enough to run in
 * several tests without slowing the whole parallel suite.
 *
 * A one-question round matters: a session only counts as completed when every
 * planned question was answered, so the default length of 10 would end the round
 * early and leave it unshareable.
 */
async function prepareOneWordRound(page: Page): Promise<string> {
  await page.goto('/settings');
  await page.getByLabel('Questions per session').fill('1');
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved.');

  const keep = (await page.locator('.vocabulary__word').first().innerText()).trim();
  await page.getByRole('checkbox', { name: /^Deselect all \d+$/ }).click();
  await expect(page.getByText('Saving...')).toHaveCount(0, { timeout: 10_000 });
  await page.locator('.vocabulary__list').getByRole('checkbox').first().check();
  await expect(page.getByText('Saving...')).toHaveCount(0, { timeout: 10_000 });
  return keep;
}

/**
 * Leaves the question card once the round is finished.
 *
 * The button that does so is named for what it will do: "Next question" while
 * questions remain, "See results" when the session is already full, and
 * "Skip to results" after a miss. It only appears once the answer has been
 * recorded server-side, so it is awaited rather than polled.
 */
async function leaveQuestionCard(page: Page): Promise<void> {
  const button = page
    .getByRole('button', {
      name: /Next question|See results|Skip to results|Show results|Finish/i,
    })
    .first();
  await expect(button).toBeVisible({ timeout: 10_000 });
  await button.click();
}

/** Completes a one-question practice round that is answered correctly. */
async function completePractice(page: Page): Promise<void> {
  const word = await prepareOneWordRound(page);
  await page.goto('/practice');
  await page.getByRole('radio', { name: 'English → German' }).check();
  await page.getByRole('button', { name: 'Start practice' }).click();
  await expect(page.getByTestId('practice-prompt')).toBeVisible();
  await page.getByLabel('Your answer').fill(answerFor(word));
  await page.getByRole('button', { name: 'Check answer' }).click();
  await leaveQuestionCard(page);
  await expect(page.getByTestId('summary-correct')).toBeVisible();
}

/**
 * Completes an exam.
 *
 * With one word enabled the exam is clamped to a single question, so answering it
 * shows the results immediately rather than offering a "Next question". The loop
 * therefore handles both: it advances when a button appears and stops as soon as
 * the results are on screen.
 */
async function completeExam(page: Page): Promise<void> {
  await prepareOneWordRound(page);
  await page.goto('/exams');
  await page.getByRole('radio', { name: 'English → German' }).check();
  await page.getByRole('button', { name: 'Start exam' }).click();
  await expect(page.getByTestId('exam-prompt')).toBeVisible();

  const results = page.getByRole('heading', { name: 'Exam results' });
  for (let i = 0; i < 10; i += 1) {
    if (await results.isVisible().catch(() => false)) break;
    const prompt = page.getByTestId('exam-prompt');
    if (!(await prompt.isVisible().catch(() => false))) break;
    const text = (await prompt.innerText()).trim();
    await page.getByLabel('Your answer').fill(answerFor(text));
    await page.getByLabel('Your answer').press('Enter');
    const next = page.getByRole('button', { name: /Next question|See results/i }).first();
    await Promise.race([
      next.waitFor({ state: 'visible', timeout: 10_000 }),
      results.waitFor({ state: 'visible', timeout: 10_000 }),
    ]).catch(() => undefined);
    if (!(await results.isVisible().catch(() => false))) await next.click();
  }
  await expect(results).toBeVisible();
}

/** The share token the page itself was given, read from the owner's API. */
async function readShareToken(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const list = await (await fetch('/api/v1/share/results')).json();
    return list.shares[0].token as string;
  });
}

/** Opens the share sheet for the current result. */
async function openShareSheet(page: Page): Promise<void> {
  await page.getByTestId('share-result').click();
  await expect(page.getByRole('dialog')).toBeVisible();
}

/** An anonymous browser: no session, no referral cookie, no storage. */
async function anonymousBrowser(context: import('@playwright/test').BrowserContext) {
  return context.browser()!.newContext();
}
test.describe('sharing a result', () => {
  test('offers Share result only after a completed practice round', async ({
    page,
    request,
  }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'share-practice');
    await logIn(page, username);
    await page.goto('/practice');
    // Before finishing anything there is no result to share.
    await expect(page.getByTestId('share-result')).toHaveCount(0);

    await completePractice(page);
    await expect(page.getByTestId('share-result')).toBeVisible();
  });

  test('shares a completed exam with the API-authoritative score', async ({
    page,
    request,
  }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'share-exam');
    await logIn(page, username);
    await page.goto('/exams');
    await completeExam(page);
    await openShareSheet(page);

    const preview = page.getByTestId('share-preview');
    await expect(preview).toContainText('1 / 1');
    await expect(preview).toContainText('100%');

    // The client cannot dictate a score, and a bogus session is not shareable.
    const statuses = await page.evaluate(async () => {
      const post = (body: unknown) =>
        fetch('/api/v1/share/results', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }).then((r) => r.status);
      return [
        await post({ sessionId: 'unknown', score: 100 }),
        await post({ sessionId: 'unknown' }),
      ];
    });
    expect(statuses).toEqual([400, 404]);
  });

  test('the public page shows the result and never the learner', async ({
    page,
    context,
    request,
  }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'share-public');
    await logIn(page, username);
    await page.goto('/exams');
    await completeExam(page);
    await openShareSheet(page);

    const token = await readShareToken(page);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // A brand-new context with no cookies at all: an anonymous recipient.
    const guest = await anonymousBrowser(context);
    const guestPage = await guest.newPage();
    await guestPage.goto(`/share/${token}`);

    await expect(
      guestPage.getByRole('heading', { name: /completed a TapTalk challenge/i }),
    ).toBeVisible();
    await expect(guestPage.getByText('1 / 1')).toBeVisible();
    await expect(guestPage.getByText('100%')).toBeVisible();
    await expect(guestPage.getByRole('button', { name: 'Try TapTalk' })).toBeVisible();
    await expect(guestPage.getByRole('button', { name: 'Log in' })).toBeVisible();

    // Nothing about the sharer, and no client-side tracking identifier.
    const body = await guestPage.locator('body').innerText();
    expect(body).not.toContain(username);
    expect(body).not.toMatch(/username|@/i);
    expect(await guestPage.evaluate(() => JSON.stringify(localStorage))).toBe('{}');
    await guest.close();
  });

  test('shows one unavailable state for an unknown share', async ({ context }) => {
    const guest = await anonymousBrowser(context);
    const page = await guest.newPage();
    await page.goto(`/share/${'z'.repeat(43)}`);
    await expect(page.getByText('This shared result is not available')).toBeVisible();
    // No distinction between "never existed" and "revoked".
    await expect(page.getByText(/revoked|expired/i)).toHaveCount(0);
    await guest.close();
  });

  test('a recipient who registers through a share is attributed', async ({
    page,
    context,
    request,
  }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'share-referral');
    await logIn(page, username);
    await page.goto('/exams');
    await completeExam(page);
    await openShareSheet(page);
    const token = await readShareToken(page);

    const guest = await anonymousBrowser(context);
    const guestPage = await guest.newPage();
    await guestPage.goto(`/share/${token}`);
    await expect(guestPage.getByText('100%')).toBeVisible();
    await guestPage.getByRole('button', { name: 'Try TapTalk' }).click();
    await guestPage.getByLabel('Username').fill(`friend-${Date.now().toString(36)}`);
    await guestPage.getByLabel('Password').fill('Another-Good-7');
    await guestPage.getByRole('button', { name: /Create account|Register/i }).click();
    await expect(guestPage.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();

    // The sharer sees a count, never the referred learner's identity.
    const signups = await page.evaluate(async () => {
      const list = await (await fetch('/api/v1/share/results')).json();
      return list.shares[0].signups as number;
    });
    expect(signups).toBe(1);
    await guest.close();
  });

  test('a session that is still running cannot be shared', async ({ page, request }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'share-active');
    await logIn(page, username);
    const status = await page.evaluate(async () => {
      const created = await (
        await fetch('/api/v1/practice/sessions', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ direction: 'english-to-german' }),
        })
      ).json();
      const response = await fetch('/api/v1/share/results', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: created.session.id }),
      });
      return response.status;
    });
    // An unfinished session has no final score, so it is refused.
    expect(status).toBe(404);
  });

  test('every string on the share sheet is translated', async ({ page, request }, testInfo) => {
    const username = await registerLearner(request, testInfo, 'share-locale');
    await logIn(page, username);
    await page.goto('/exams');
    await completeExam(page);
    await openShareSheet(page);
    const text = await page.getByRole('dialog').innerText();
    // Nothing fell through to a raw translation key.
    expect(text).not.toContain('share.');
    expect(text).not.toContain('common.');
    // The whole sheet reads as English, not as key names or empty strings.
    for (const expected of [
      'Share your result',
      '1 / 1',
      '100%',
      'Exam',
      'English → German',
      'Copy link',
      'Save image',
      'Copy message',
      'Close',
    ]) {
      expect(text).toContain(expected);
    }
    // Headless Chromium has no OS share sheet, so the fallback is what leads.
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  });
});
