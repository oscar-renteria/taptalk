import { access, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, relative, resolve } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const requiredArtifacts = [
  'packages/shared/dist/index.js',
  'packages/shared/dist/index.d.ts',
  'apps/api/dist/main.js',
  'apps/api/dist/server.js',
  'apps/api/dist/database.js',
  'apps/api/dist/cli/migrate.js',
  'apps/api/dist/migrations/001_initial.sql',
  'apps/api/dist/migrations/002_practice_sessions.sql',
  'apps/web/dist/index.html',
  'apps/web/dist/manifest.webmanifest',
  'apps/web/dist/sw.js',
  'database/migrations/001_initial.sql',
  'database/migrations/002_practice_sessions.sql',
];
const outputDirectories = ['packages/shared/dist', 'apps/api/dist', 'apps/web/dist'];

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await filesIn(path)));
    else files.push(path);
  }
  return files;
}

for (const artifact of requiredArtifacts) {
  await access(resolve(repositoryRoot, artifact));
}

const testArtifacts = [];
for (const directory of outputDirectories) {
  const files = await filesIn(resolve(repositoryRoot, directory));
  testArtifacts.push(
    ...files.filter((file) => file.endsWith('.test.js') || file.endsWith('.test.d.ts')),
  );
}

if (testArtifacts.length > 0) {
  throw new Error(
    `Production output contains test artifacts:\n${testArtifacts
      .map((file) => relative(repositoryRoot, file))
      .join('\n')}`,
  );
}

console.log('Production build artifacts verified.');
