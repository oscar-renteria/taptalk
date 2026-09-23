// Usage: DATABASE_PATH=./database/taptalk.db npm run set-role --workspace @taptalk/api -- <username> <user|administrator>
import { openDatabase } from '../database.js';
import { setUserRole } from '../repositories.js';

const [username, role] = process.argv.slice(2);
const databasePath = process.env.DATABASE_PATH;

if (!databasePath || !username || (role !== 'user' && role !== 'administrator')) {
  console.error(
    'Usage: DATABASE_PATH=<file> npm run set-role --workspace @taptalk/api -- <username> <user|administrator>',
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
