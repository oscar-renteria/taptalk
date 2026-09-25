import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { startServer } from './main.js';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('API process lifecycle', () => {
  it('migrates before listening and becomes ready only after startup', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'taptalk-lifecycle-'));
    temporaryDirectories.push(directory);
    const config = loadConfig({
      NODE_ENV: 'test',
      API_HOST: '127.0.0.1',
      API_PORT: '3000',
      DATABASE_PATH: join(directory, 'taptalk.db'),
      LOG_LEVEL: 'silent',
    });
    const running = await startServer({ ...config, apiPort: 0 });

    try {
      const address = running.server.server.address();
      expect(address).toMatchObject({ address: '127.0.0.1' });
      expect(typeof address).toBe('object');
      const health = await running.server.inject({ method: 'GET', url: '/health' });
      const ready = await running.server.inject({ method: 'GET', url: '/ready' });
      expect(health.statusCode).toBe(200);
      expect(ready.statusCode).toBe(200);
      expect(
        running.database.prepare('SELECT COUNT(*) AS count FROM schema_migrations').get(),
      ).toEqual({
        count: 2,
      });
    } finally {
      await running.close();
    }

    await expect(running.close()).resolves.toBeUndefined();
  });
});
