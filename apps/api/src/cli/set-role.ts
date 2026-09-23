// Usage: npm run set-role --workspace @taptalk/api -- <username> <user|administrator>
// Uses DATABASE_PATH from the environment or the repository's .env (the same database as the API).
import '../load-env.js';
import { openDatabase } from '../database.js';
import { setUserRole } from '../repositories.js';

const [username, role] = process.argv.slice(2);
const databasePath = process.env.DATABASE_PATH;

if (!databasePath || !username || (role !== 'user' && role !== 'administrator')) {
  console.error(
    'Usage: npm run set-role --workspace @taptalk/api -- <username> <user|administrator> (needs DATABASE_PATH, from the environment or .env)',
  );
  process.exit(2);
}

const database = openDatabase(databasePath);
try {
  if (!setUserRole(database, username, role, new Date().toISOString())) {
    console.error(`No account named "${username}" exists. Register it first.`);
    process.exit(1);
  }
  console.log(`Role of "${username}" is now "${role}".`);
} finally {
  database.close();
}
