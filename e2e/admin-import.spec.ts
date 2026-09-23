import { expect, test } from '@playwright/test';
import { adminImportVocabulary } from './fixtures/vocabulary';
import { logIn, navigateTo, uniqueUsername } from './support/app';
import { administrator } from './support/environment';

test.describe('administrator vocabulary import', () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page, administrator.username, administrator.password);
    await navigateTo(page, 'Import vocabulary');
    await expect(page.getByRole('heading', { name: 'Manage vocabulary.' })).toBeVisible();
  });

  test('previews and commits a valid vocabulary file', async ({ page }, testInfo) => {
    const sourceName = `${uniqueUsername(testInfo, 'import')}.json`;
    await page.getByLabel('Vocabulary JSON file').setInputFiles({
      name: sourceName,
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(adminImportVocabulary)),
    });
    await expect(page.getByText(`Selected: ${sourceName}`)).toBeVisible();

    await page.getByRole('button', { name: 'Preview import' }).click();
    await expect(page.getByText(`${adminImportVocabulary.length} valid records`)).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and import' }).click();
    await expect(page.getByRole('status')).toHaveText('Import committed successfully.');
    await expect(page.getByRole('button', { name: 'Confirm and import' })).toHaveCount(0);

    await expect(
      page
        .getByRole('list', { name: 'Import history' })
        .getByRole('listitem')
        .filter({ hasText: sourceName }),
    ).toContainText('committed');
  });

  test('an invalid file cannot be committed', async ({ page }) => {
    await page.getByLabel('Vocabulary JSON file').setInputFiles({
      name: 'broken.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify([{ english: '', german: '' }])),
    });
    await page.getByRole('button', { name: 'Preview import' }).click();

    await expect(page.getByText('1 invalid records')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm and import' })).toBeDisabled();
  });
});
