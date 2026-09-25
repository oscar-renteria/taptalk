import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { resolveFromRoot } from './paths.js';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: typeof DatabaseSyncType;
};

export type SqliteDatabase = DatabaseSyncType;

export type OpenDatabaseOptions = {
  migrate?: boolean;
};

export function openDatabase(
  databasePath = process.env.DATABASE_PATH ?? ':memory:',
  options: OpenDatabaseOptions = {},
): SqliteDatabase {
  const location = databasePath === ':memory:' ? databasePath : resolveFromRoot(databasePath);
  if (location !== ':memory:') mkdirSync(dirname(location), { recursive: true });
  const database = new DatabaseSync(location);
  database.exec('PRAGMA foreign_keys = ON;');
  if (options.migrate !== false) migrateDatabase(database);
  return database;
}

const defaultMigrationsDirectory = fileURLToPath(
  new URL('../../../database/migrations', import.meta.url),
);

export function migrateDatabase(
  database: SqliteDatabase,
  migrationsDirectory = defaultMigrationsDirectory,
): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    database
      .prepare('SELECT id FROM schema_migrations ORDER BY id')
      .all()
      .map((row) => String(row.id)),
  );
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  for (const migrationFile of migrationFiles) {
    if (applied.has(migrationFile)) {
      continue;
    }

    const migrationSql = readFileSync(join(migrationsDirectory, migrationFile), 'utf8');
    database.exec('BEGIN');
    try {
      database.exec(migrationSql);
      database
        .prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)')
        .run(migrationFile, new Date().toISOString());
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }
}

export function createId(): string {
  return crypto.randomUUID();
}
