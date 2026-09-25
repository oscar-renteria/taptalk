import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const writer = `
  import { DatabaseSync } from 'node:sqlite';
  const database = new DatabaseSync(process.env.TAPTALK_PERSISTENCE_DB);
  database.exec("CREATE TABLE IF NOT EXISTS persistence (value TEXT NOT NULL)");
  database.prepare("INSERT INTO persistence (value) VALUES (?)").run("survives-restart");
  database.close();
`;

const reader = `
  import { DatabaseSync } from 'node:sqlite';
  const database = new DatabaseSync(process.env.TAPTALK_PERSISTENCE_DB, { readOnly: true });
  const row = database.prepare("SELECT value FROM persistence ORDER BY rowid DESC LIMIT 1").get();
  database.close();
  if (row?.value !== "survives-restart") process.exit(1);
`;

function runModule(source, databasePath) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], {
    env: { ...process.env, TAPTALK_PERSISTENCE_DB: databasePath },
    encoding: 'utf8',
  });
}

test('keeps SQLite data when the writing process exits and a new process reopens it', () => {
  const directory = mkdtempSync(join(tmpdir(), 'taptalk-sqlite-persistence-'));
  const databasePath = join(directory, 'taptalk.db');
  try {
    const write = runModule(writer, databasePath);
    assert.equal(write.status, 0, write.stderr);
    const read = runModule(reader, databasePath);
    assert.equal(read.status, 0, read.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
