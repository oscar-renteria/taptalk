import { join } from 'node:path';

// Dedicated ports keep the suite independent of a running `npm run dev`.
export const apiPort = 3100;
export const webPort = 5174;

// Recreated by start-api.mts on every run; never points at a development or production database.
export const databasePath = join(__dirname, '..', '.data', 'taptalk-e2e.db');

// Test-only credentials for the throwaway e2e database. They are not secrets.
export const administrator = { username: 'e2e-admin', password: 'e2e-admin-password' };
export const learnerPassword = 'e2e-learner-password';
