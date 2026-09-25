import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';
import { startServer } from './main.js';
import { repositoryRoot } from './paths.js';

const temporaryDirectories: string[] = [];
const childProcesses = new Set<ReturnType<typeof spawn>>();

afterEach(() => {
  for (const child of childProcesses) child.kill('SIGKILL');
  childProcesses.clear();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('Could not allocate a test port.')));
        return;
      }
      probe.close(() => resolve(address.port));
    });
  });
}

function waitForReady(port: number, child: ReturnType<typeof spawn>): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 10_000;
    const check = async () => {
      if (child.exitCode !== null) {
        reject(new Error(`API process exited before readiness with code ${child.exitCode}.`));
        return;
      }
      try {
        const response = await fetch(`http://127.0.0.1:${port}/ready`);
        if (response.status === 200) {
          resolve();
          return;
        }
      } catch {
        // The listener is not accepting connections yet.
      }
      if (Date.now() >= deadline) {
        reject(new Error('API process did not become ready within 10 seconds.'));
        return;
      }
      setTimeout(() => void check(), 50);
    };
    void check();
  });
}

function waitForExit(
  child: ReturnType<typeof spawn>,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve) => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
}

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

  it.each(['SIGTERM', 'SIGINT'] as const)('shuts down cleanly on %s', async (signal) => {
    const directory = mkdtempSync(join(tmpdir(), 'taptalk-signal-'));
    temporaryDirectories.push(directory);
    const port = await availablePort();
    const child = spawn(
      process.execPath,
      [
        join(repositoryRoot, 'node_modules/tsx/dist/cli.mjs'),
        join(repositoryRoot, 'apps/api/src/main.ts'),
      ],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          NODE_ENV: 'development',
          ENV_FILE: 'none',
          API_HOST: '127.0.0.1',
          API_PORT: String(port),
          DATABASE_PATH: join(directory, 'taptalk.db'),
          LOG_LEVEL: 'silent',
          SHUTDOWN_TIMEOUT_MS: '1000',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    childProcesses.add(child);
    const output: string[] = [];
    child.stdout?.on('data', (chunk) => output.push(String(chunk)));
    child.stderr?.on('data', (chunk) => output.push(String(chunk)));

    try {
      await waitForReady(port, child);
      const exitPromise = waitForExit(child);
      expect(child.kill(signal)).toBe(true);
      const result = await exitPromise;
      expect(result, output.join('')).toEqual({ code: 0, signal: null });
    } finally {
      childProcesses.delete(child);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  });
});
