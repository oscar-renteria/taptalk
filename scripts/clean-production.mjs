import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const outputDirectories = ['packages/shared/dist', 'apps/api/dist', 'apps/web/dist'];

for (const directory of outputDirectories) {
  await rm(resolve(repositoryRoot, directory), { force: true, recursive: true });
}

console.log('Production build output cleaned.');
