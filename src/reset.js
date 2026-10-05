import { openDb, DB_PATH } from './db.js';

if (process.env.TURSO_DATABASE_URL) {
  console.error('[db] refusing to reset: TURSO_DATABASE_URL is set (this only resets the local file)');
  process.exit(1);
}
const { db } = await openDb({ fresh: true });
db.close();
console.log('[db] reset complete →', DB_PATH);
