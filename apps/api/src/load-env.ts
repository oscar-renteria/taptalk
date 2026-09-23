// Side-effect module, imported first by every entry point (server, CLI): loads the repository's
// `.env` so `cp .env.example .env && npm run dev` works without extra setup.
// - Variables already set in the environment win over the file.
// - Skipped in production (configuration comes from the deployment) and in tests.
// - ENV_FILE=<path> selects another file; ENV_FILE=none disables loading (used by e2e).
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './paths.js';

export function loadEnvironmentFile(environment: NodeJS.ProcessEnv = process.env): string | null {
  if (environment.NODE_ENV === 'production' || environment.NODE_ENV === 'test') return null;
  if (environment.ENV_FILE === 'none') return null;
  const file = resolve(repositoryRoot, environment.ENV_FILE ?? '.env');
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}

loadEnvironmentFile();
