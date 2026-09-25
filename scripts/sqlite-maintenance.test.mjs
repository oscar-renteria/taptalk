import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { backupDatabase, restoreDatabase } from './sqlite-maintenance.mjs';

test('creates and verifies a SQLite backup, then restores it into a clean target', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taptalk-sqlite-maintenance-'));
  const source = join(directory, 'source.db');
  const backup = join(directory, 'backup.db');
  const target = join(directory, 'restored.db');
  const database = new DatabaseSync(source);
  database.exec(
    "CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO records VALUES (1, 'kept')",
  );
  database.close();

  try {
    assert.equal(backupDatabase(source, backup), backup);
    const restored = restoreDatabase(backup, target);
    assert.equal(restored.target, target);
    const restoredDatabase = new DatabaseSync(target, { readOnly: true });
    assert.deepEqual(
      { ...restoredDatabase.prepare('SELECT * FROM records').get() },
      { id: 1, value: 'kept' },
    );
    assert.equal(restoredDatabase.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
    restoredDatabase.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('requires an explicit force flag before replacing an existing target', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taptalk-sqlite-force-'));
  const source = join(directory, 'source.db');
  const backup = join(directory, 'backup.db');
  const target = join(directory, 'target.db');
  const database = new DatabaseSync(source);
  database.exec('CREATE TABLE records (id INTEGER); INSERT INTO records VALUES (1)');
  database.close();
  const targetDatabase = new DatabaseSync(target);
  targetDatabase.exec('CREATE TABLE old_records (id INTEGER)');
  targetDatabase.close();

  try {
    backupDatabase(source, backup);
    assert.throws(() => restoreDatabase(backup, target), /--force/);
    const result = restoreDatabase(backup, target, { force: true });
    assert.match(result.previous, /target\.db\.before-restore-/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
