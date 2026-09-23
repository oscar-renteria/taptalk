// Starts the API against a freshly created SQLite file so every e2e run begins from a clean state.
import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';

const databasePath = process.env.DATABASE_PATH;
if (!databasePath || !databasePath.includes('taptalk-e2e')) {
  throw new Error('DATABASE_PATH must point at the dedicated e2e database.');
}

mkdirSync(dirname(databasePath), { recursive: true });
for (const suffix of ['', '-wal', '-shm', '-journal']) {
  rmSync(`${databasePath}${suffix}`, { force: true });
}

await import('../../apps/api/src/server.ts');
