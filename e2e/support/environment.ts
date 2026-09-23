import { join } from 'node:path';

// Dedicated ports keep the suite independent of a running `npm run dev`.
export const apiPort = 3100;
export const webPort = 5174;
// Production build (vite preview) with the service worker, used by the `pwa` project.
export const previewPort = 5176;

// Recreated by start-api.mts on every run; never points at a development or production database.
export const databasePath = join(__dirname, '..', '.data', 'taptalk-e2e.db');

// Test-only credentials for the throwaway e2e database. They are not secrets.
export const administrator = { username: 'e2e-admin', password: 'setup-only-secret-9' };
export const learnerPassword = 'e2e-learner-password';
