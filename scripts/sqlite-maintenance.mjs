import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

function fail(message) {
  throw new Error(message);
}

function assertFile(path, label) {
  if (!existsSync(path) || !statSync(path).isFile()) fail(`${label} does not exist: ${path}`);
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function assertIntegrity(database, path) {
  const result = database.prepare('PRAGMA integrity_check').get();
  if (result.integrity_check !== 'ok') fail(`SQLite integrity check failed for ${path}.`);
}

function checkIntegrity(path) {
  assertFile(path, 'SQLite file');
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    assertIntegrity(database, path);
  } finally {
    database.close();
  }
}

export function backupDatabase(sourceArgument, destinationArgument) {
  if (!sourceArgument || !destinationArgument) {
    fail('Usage: sqlite-maintenance.mjs backup <source.db> <destination.db>');
  }
  if (sourceArgument === ':memory:') fail('Cannot back up an in-memory database.');
  const source = resolve(sourceArgument);
  const destination = resolve(destinationArgument);
  if (source === destination) fail('Source and destination must be different paths.');
  assertFile(source, 'Source database');
  if (existsSync(destination)) fail(`Backup destination already exists: ${destination}`);
  mkdirSync(dirname(destination), { recursive: true });

  const database = new DatabaseSync(source, { readOnly: true });
  try {
    assertIntegrity(database, source);
    database.exec(`VACUUM INTO ${sqlString(destination)}`);
  } finally {
    database.close();
  }
  checkIntegrity(destination);
  chmodSync(destination, 0o600);
  return destination;
}

export function restoreDatabase(backupArgument, targetArgument, { force = false } = {}) {
  if (!backupArgument || !targetArgument) {
    fail('Usage: sqlite-maintenance.mjs restore <backup.db> <target.db> [--force]');
  }
  const backup = resolve(backupArgument);
  const target = resolve(targetArgument);
  if (backup === target) fail('Backup and target must be different paths.');
  assertFile(backup, 'Backup database');
  checkIntegrity(backup);
  mkdirSync(dirname(target), { recursive: true });

  const temporary = `${target}.restore-${process.pid}-${Date.now()}`;
  let previous;
  try {
    copyFileSync(backup, temporary);
    chmodSync(temporary, 0o600);
    checkIntegrity(temporary);
    if (existsSync(target)) {
      if (!force) fail(`Target already exists; pass --force to preserve and replace it: ${target}`);
      previous = `${target}.before-restore-${Date.now()}`;
      renameSync(target, previous);
    }
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { force: true });
    if (previous && existsSync(previous) && !existsSync(target)) renameSync(previous, target);
    throw error;
  }
  return { target, previous };
}

function usage() {
  console.error('Usage: node scripts/sqlite-maintenance.mjs <backup|restore> ...');
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'backup') {
    const destination = backupDatabase(args[0], args[1]);
    console.log(`SQLite backup created: ${destination}`);
    return;
  }
  if (command === 'restore') {
    const force = args.includes('--force');
    const paths = args.filter((argument) => argument !== '--force');
    const result = restoreDatabase(paths[0], paths[1], { force });
    console.log(`SQLite database restored: ${result.target}`);
    if (result.previous) console.log(`Previous database preserved: ${result.previous}`);
    return;
  }
  usage();
  process.exitCode = 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
