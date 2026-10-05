import { openDb, DB_PATH } from './db.js';

const db = openDb({ fresh: true });
db.close();
console.log('[db] reset complete →', DB_PATH);
