import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openDatabase } from './database.js';
import { loadEnvironmentFile } from './load-env.js';
import { repositoryRoot, resolveFromRoot } from './paths.js';

const directory = mkdtempSync(join(tmpdir(), 'taptalk-env-'));
const file = join(directory, 'test.env');
writeFileSync(file, 'TAPTALK_ENV_PROBE=from-file\nTAPTALK_ENV_KEPT=from-file\n');

afterEach(() => {
  delete process.env.TAPTALK_ENV_PROBE;
  delete process.env.TAPTALK_ENV_KEPT;
});

describe('environment file loading', () => {
  it('loads the file in development without overriding variables that are already set', () => {
    process.env.TAPTALK_ENV_KEPT = 'from-shell';
    expect(loadEnvironmentFile({ NODE_ENV: 'development', ENV_FILE: file })).toBe(file);
    expect(process.env.TAPTALK_ENV_PROBE).toBe('from-file');
    expect(process.env.TAPTALK_ENV_KEPT).toBe('from-shell');
  });

  it.each([
    [{ NODE_ENV: 'production', ENV_FILE: file }, 'production'],
    [{ NODE_ENV: 'test', ENV_FILE: file }, 'tests'],
    [{ NODE_ENV: 'development', ENV_FILE: 'none' }, 'ENV_FILE=none'],
    [{ NODE_ENV: 'development', ENV_FILE: join(directory, 'missing.env') }, 'a missing file'],
  ])('is skipped for %j (%s)', (environment) => {
    expect(loadEnvironmentFile(environment)).toBeNull();
    expect(process.env.TAPTALK_ENV_PROBE).toBeUndefined();
  });
});

describe('paths', () => {
  it('resolves relative configuration paths from the repository root', () => {
    expect(resolveFromRoot('./database/taptalk.db')).toBe(
      join(repositoryRoot, 'database', 'taptalk.db'),
    );
    expect(resolveFromRoot('/var/lib/taptalk.db')).toBe('/var/lib/taptalk.db');
    expect(existsSync(join(repositoryRoot, 'database', 'migrations'))).toBe(true);
  });

  it('creates the database directory when it does not exist yet', () => {
    const location = join(directory, 'nested', 'dir', 'taptalk.db');
    const database = openDatabase(location);
    database.close();
    expect(existsSync(location)).toBe(true);
    rmSync(directory, { recursive: true, force: true });
  });
});
