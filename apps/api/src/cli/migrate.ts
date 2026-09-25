import { loadConfig } from '../config.js';
import { migrateDatabase, openDatabase } from '../database.js';

const config = loadConfig();
const database = openDatabase(config.databasePath, { migrate: false });
try {
  migrateDatabase(database);
  console.log('Database migrations are up to date.');
} finally {
  database.close();
}
