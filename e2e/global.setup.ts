import { execFileSync } from 'node:child_process';
import { expect, test as setup } from '@playwright/test';
import { seedVocabulary } from './fixtures/vocabulary';
import { administrator, databasePath } from './support/environment';

// Provisions the administrator the same way operators do: register, then promote with the
// documented `set-role` CLI (see docs/operations/administrator-provisioning.md).
setup('provision administrator and seed vocabulary', async ({ request }) => {
  const registered = await request.post('/api/v1/auth/register', { data: administrator });
  expect(registered.status()).toBe(201);

  execFileSync(
    'npm',
    [
      'run',
      'set-role',
      '--workspace',
      '@taptalk/api',
      '--',
      administrator.username,
      'administrator',
    ],
    {
      env: { ...process.env, DATABASE_PATH: databasePath },
      stdio: 'pipe',
    },
  );

  const imported = await request.post('/api/v1/admin/vocabulary/import', {
    data: { content: JSON.stringify(seedVocabulary), sourceName: 'e2e-seed.json', confirm: true },
  });
  expect(imported.status()).toBe(201);
});
