import { expect, test } from '@playwright/test';
import { answerFor } from './fixtures/vocabulary';
import { logIn, navigateTo, registerLearner } from './support/app';
import { learnerPassword } from './support/environment';

/** The Settings vocabulary rows, as accessible checkbox controls. */
function rows(page: import('@playwright/test').Page) {
  return page.getByRole('checkbox');
}

/** Waits for the debounced save to finish, the way a user waits for "Saving...". */
async function saved(page: import('@playwright/test').Page) {
  await expect(page.getByText('Saving...')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(300);
}

/** The English word on the row that is still enabled, read from the UI. */
async function enabledWord(page: import('@playwright/test').Page): Promise<string> {
  return page
    .locator('.vocabulary__row')
    .filter({ has: page.locator('input[type="checkbox"]:checked') })
    .locator('.vocabulary__word')
    .innerText();
}

/**
 * Plays several questions and returns every prompt seen, so a test can assert
 * that a disabled word is never asked.
 */
async function promptsSeen(
  page: import('@playwright/test').Page,
  rounds: number,
): Promise<string[]> {
  const seen: string[] = [];
  await navigateTo(page, 'Practice');
  // Pinned to English -> German so every prompt is a word the fixtures know.
  await page.getByRole('radio', { name: 'English → German' }).check();
  for (let round = 0; round < rounds; round += 1) {
    const start = page.getByRole('button', { name: 'Start practice' });
    if (await start.isVisible()) {
      await start.click();
      await page.waitForSelector('[data-testid="practice-prompt"]');
    }
    // The field is readonly while a verdict is showing, so wait for the card to
    // become interactive again rather than racing it.
    await expect(page.getByLabel('Your answer')).toBeEnabled();
    const prompt = (await page.getByTestId('practice-prompt').innerText()).trim();
    seen.push(prompt);
    // Answered correctly so the round advances the same way it does for a user.
    await page.getByLabel('Your answer').fill(answerFor(prompt));
    await page.locator('form.practice-card').press('Enter');
    await expect(page.locator('.practice-card__verdict')).toBeVisible();
    const next = page.locator('.practice-action button[type="submit"]');
    if (!(await next.innerText()).includes('Next question')) break;
    await next.click();
    // The next question is fetched, so the prompt text is what confirms arrival.
    await expect(page.getByLabel('Your answer')).toBeEnabled();
  }
  return seen;
}

async function openSettings(page: import('@playwright/test').Page) {
  await navigateTo(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Practice vocabulary' })).toBeVisible();
  await expect(rows(page).first()).toBeVisible();
}

test.describe('practice vocabulary selection', () => {
  test('a learner can switch entries off and Practice Mode never asks them', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'vocab'));
    await openSettings(page);

    // Everything is on to begin with.
    const total = await rows(page).count();
    expect(total).toBeGreaterThan(1);
    for (let i = 0; i < total; i += 1) {
      await expect(rows(page).nth(i)).toBeChecked();
    }

    // Switch off everything except the first entry.
    for (let i = 1; i < total; i += 1) {
      await rows(page).nth(i).uncheck();
    }
    await expect(page.getByText(/1 of \d+ words selected for practice/)).toBeVisible();
    await saved(page);

    // The list is saved for this account and survives a reload.
    await page.reload();
    await expect(rows(page).first()).toBeChecked();
    await expect(rows(page).nth(1)).not.toBeChecked();

    // Now practise repeatedly: the one entry still on is the only one that may
    // be asked, and every prompt must be that entry.
    const only = await enabledWord(page);
    const seen = await promptsSeen(page, 6);
    expect(seen.length).toBeGreaterThan(0);
    for (const prompt of seen) expect(prompt).toBe(only);
  });

  test('deselecting everything blocks practice with a way out', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'vocab-none'));
    await openSettings(page);

    await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
    await expect(page.getByText('No vocabulary is currently selected for practice')).toBeVisible();
    await saved(page);

    await navigateTo(page, 'Practice');
    await page.getByRole('button', { name: 'Start practice' }).click();
    // A clear message rather than an empty or broken card.
    await expect(page.getByText('No vocabulary is currently selected for practice.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Choose practice vocabulary' })).toBeVisible();
    // Following the link takes the user to the place that fixes it.
    await page.getByRole('link', { name: 'Choose practice vocabulary' }).click();
    await expect(page.getByRole('heading', { name: 'Practice vocabulary' })).toBeVisible();

    await page.getByRole('button', { name: 'Select all', exact: true }).click();
    await saved(page);
    await navigateTo(page, 'Practice');
    await page.getByRole('button', { name: 'Start practice' }).click();
    await page.waitForSelector('[data-testid="practice-prompt"]');
  });

  test('a guest can select their own vocabulary, kept out of the database', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Continue as Guest' }).click();
    await page.waitForURL(/practice/);
    await openSettings(page);

    const total = await rows(page).count();
    expect(total).toBeGreaterThan(1);
    // Read the word from the row being switched off, so the assertion follows
    // the list order instead of assuming it.
    const switchedOff = (
      await page.locator('.vocabulary__row').nth(1).locator('.vocabulary__word').innerText()
    ).trim();
    await rows(page).nth(1).uncheck();
    await saved(page);
    // The guest's own choice survives a reload, as guest state does.
    await page.reload();
    await expect(rows(page).nth(1)).not.toBeChecked();

    // Practice respects it for the guest too.
    const seen = await promptsSeen(page, 6);
    expect(seen.length).toBeGreaterThan(0);
    for (const prompt of seen) expect(prompt).not.toBe(switchedOff);
  });

  test('one account selection does not affect another', async ({ page, request }, testInfo) => {
    const first = await registerLearner(request, testInfo, 'vocab-a');
    await logIn(page, first);
    await openSettings(page);
    await page.getByRole('button', { name: 'Deselect all', exact: true }).click();
    await saved(page);

    // Sign out first: a signed-in visitor is redirected away from /login.
    await page.getByRole('button', { name: /Account menu for/ }).click();
    await page.getByRole('button', { name: 'Log out' }).click();
    await expect(page.getByLabel('Username')).toBeVisible();

    const second = await registerLearner(request, testInfo, 'vocab-b');
    await page.getByLabel('Username').fill(second);
    await page.getByLabel('Password').fill(learnerPassword);
    await page.getByRole('button', { name: 'Log in' }).click();
    await openSettings(page);
    // A fresh account starts from its own default, not the first one's.
    for (let i = 0; i < (await rows(page).count()); i += 1) {
      await expect(rows(page).nth(i)).toBeChecked();
    }
  });

  test('the section is localized', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'vocab-i18n'));
    // The language picker lives on Settings, which is where the section is too.
    await navigateTo(page, 'Settings');
    await openSettings(page);
    await page.getByLabel('App language').selectOption('de');
    await expect(page.getByRole('heading', { name: 'Übungsvokabeln' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Alle auswählen', exact: true })).toBeVisible();
    await page.getByLabel('App-Sprache').selectOption('es');
    await expect(page.getByRole('heading', { name: 'Vocabulario de práctica' })).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Seleccionar todas', exact: true }),
    ).toBeVisible();
  });

  test('the rows are large enough to tap and reachable by keyboard', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'vocab-a11y'));
    await openSettings(page);

    // Every row is at least 44px tall, so the whole row is the touch target.
    const heights = await page
      .locator('.vocabulary__row')
      .evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(0);
    for (const height of heights) expect(height).toBeGreaterThanOrEqual(44);

    // The first checkbox is focusable and toggles from the keyboard.
    await rows(page).first().focus();
    await expect(rows(page).first()).toBeFocused();
    await page.keyboard.press('Space');
    await expect(rows(page).first()).not.toBeChecked();
  });
});

test.describe('a long list stays usable', () => {
  test('search narrows the list and reports how many are shown', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'vocab-search'));
    await openSettings(page);
    const total = await rows(page).count();
    expect(total).toBeGreaterThan(2);
    // Take a real word from the list so the test does not assume which words the
    // fixtures happen to contain.
    const target = (await page.locator('.vocabulary__word').first().innerText()).trim();

    await page.getByLabel('Search words').fill(target);
    // The count line only appears once the filter has been applied.
    const shownLine = page.getByText(/^\d+ of \d+ shown$/);
    await expect(shownLine).toBeVisible();
    const shown = Number((await shownLine.innerText()).split(' ')[0]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);
    await expect(rows(page)).toHaveCount(shown);

    // Clearing the search brings everything back.
    await page.getByLabel('Search words').fill('');
    await expect(rows(page)).toHaveCount(total);
    await expect(shownLine).toHaveCount(0);
  });

  test('the bulk buttons only touch the words the search shows', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'vocab-scoped'));
    await openSettings(page);
    const total = await rows(page).count();
    const target = (await page.locator('.vocabulary__word').first().innerText()).trim();

    await page.getByLabel('Search words').fill(target);
    const shownLine = page.getByText(/^\d+ of \d+ shown$/);
    await expect(shownLine).toBeVisible();
    const shown = Number((await shownLine.innerText()).split(' ')[0]);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(total);

    // The label says how many rows the action will change, not "all".
    const deselect = page.getByRole('button', { name: `Deselect these ${shown}`, exact: true });
    await expect(deselect).toBeVisible();
    await deselect.click();
    await saved(page);

    // Exactly the visible rows went off, and nothing outside the search did.
    await expect(
      page.getByText(new RegExp(`^${total - shown} of ${total} words selected for practice$`)),
    ).toBeVisible();

    await page.getByLabel('Search words').fill('');
    await expect(rows(page)).toHaveCount(total);
    const off = await page
      .locator('.vocabulary__row:not(:has(input:checked)) .vocabulary__word')
      .allInnerTexts();
    expect(off.map((word) => word.trim())).toEqual([target]);
  });

  test('a search with no matches says so instead of showing an empty list', async ({
    page,
    request,
  }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'vocab-nomatch'));
    await openSettings(page);
    await page.getByLabel('Search words').fill('zzzzzz');
    await expect(page.getByText('No words match your search.')).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    // The selection itself is untouched: clearing the search restores it.
    await page.getByLabel('Search words').fill('');
    await expect(rows(page).first()).toBeChecked();
  });

  test('the search is localized', async ({ page, request }, testInfo) => {
    await logIn(page, await registerLearner(request, testInfo, 'vocab-search-i18n'));
    await openSettings(page);
    await page.getByLabel('App language').selectOption('de');
    await expect(page.getByLabel('Wörter suchen')).toBeVisible();
    await page.getByLabel('App-Sprache').selectOption('es');
    await expect(page.getByLabel('Buscar palabras')).toBeVisible();
  });
});
