import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_DIR = path.resolve(here, '../database');
export const DB_PATH = process.env.NOCHILL_DB ?? path.join(DB_DIR, 'nochill.db');

const ITEM_PRICES = { plate: 120, mug: 250, keyboard: 2490, phone: 18900, docs: 0 };

/** Bump when schema.sql changes shape; add a step to MIGRATIONS below. */
const SCHEMA_VERSION = 2;

const sql = (file) => readFileSync(path.join(DB_DIR, file), 'utf8');

function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    fn();
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Upgrade steps for databases created by an older version. `data` files also
 * run on fresh databases so seed content lives in exactly one place.
 */
const MIGRATIONS = {
  2: {
    // v1 → v2: 'mash' mode + roast category (CHECK constraints) and a keystrokes column.
    // SQLite can't alter a CHECK, so rebuild the two tables and copy the rows across.
    upgrade(db) {
      db.exec('PRAGMA foreign_keys = OFF');
      // Keep FKs in smashes/grievances pointing at "sessions" while we swap tables.
      db.exec('PRAGMA legacy_alter_table = ON');
      try {
        transaction(db, () => {
          db.exec(`
            DROP INDEX IF EXISTS idx_sessions_client;
            DROP INDEX IF EXISTS idx_sessions_created;
            DROP INDEX IF EXISTS idx_roasts_category;
            ALTER TABLE sessions RENAME TO _sessions_v1;
            ALTER TABLE roasts RENAME TO _roasts_v1;
          `);
          db.exec(sql('schema.sql'));
          db.exec(`
            INSERT INTO sessions (id, client_id, mode, hold_ms, peak_pressure, items_destroyed, damage_baht, created_at)
              SELECT id, client_id, mode, hold_ms, peak_pressure, items_destroyed, damage_baht, created_at FROM _sessions_v1;
            INSERT INTO roasts (id, category, text, spice)
              SELECT id, category, text, spice FROM _roasts_v1;
            DROP TABLE _sessions_v1;
            DROP TABLE _roasts_v1;
          `);
          db.exec(sql('migrations/002_mash_roasts.sql'));
        });
      } finally {
        db.exec('PRAGMA legacy_alter_table = OFF');
        db.exec('PRAGMA foreign_keys = ON');
      }
    },
    data: 'migrations/002_mash_roasts.sql',
  },
};

/** Generate two weeks of demo activity so charts aren't empty on first run. */
function seedDemoSessions(db) {
  let s = 42;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const insertSession = db.prepare(`
    INSERT INTO sessions (client_id, mode, hold_ms, peak_pressure, items_destroyed, damage_baht, keystrokes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`);
  const insertSmash = db.prepare('INSERT INTO smashes (session_id, item, count) VALUES (?, ?, ?)');
  const items = Object.keys(ITEM_PRICES).filter((k) => k !== 'docs');

  for (let day = 13; day >= 0; day--) {
    // Mondays hit harder.
    const count = 3 + Math.floor(rand() * 6) + (day % 7 === 0 ? 6 : 0);
    for (let i = 0; i < count; i++) {
      const roll = rand();
      const mode = roll < 0.55 ? 'rage' : roll < 0.8 ? 'shredder' : 'mash';
      const hold = 1500 + Math.floor(rand() * 7000);
      const pressure = Math.min(100, Math.round((hold / 8000) * 100 * (0.8 + rand() * 0.3)));
      const offset = `-${day} days`;
      if (mode === 'rage') {
        const tally = {};
        const n = Math.max(1, Math.round(pressure / 10));
        for (let k = 0; k < n; k++) {
          const it = items[Math.floor(rand() * rand() * items.length)];
          tally[it] = (tally[it] ?? 0) + 1;
        }
        const damage = Object.entries(tally).reduce((a, [it, c]) => a + ITEM_PRICES[it] * c, 0);
        const { lastInsertRowid } = insertSession.run('seed', mode, hold, pressure, n, damage, 0, offset);
        for (const [it, c] of Object.entries(tally)) insertSmash.run(lastInsertRowid, it, c);
      } else if (mode === 'shredder') {
        const { lastInsertRowid } = insertSession.run('seed', mode, hold, pressure, 1, 0, 0, offset);
        insertSmash.run(lastInsertRowid, 'docs', 1);
      } else {
        const keys = Math.round(hold / 1000 * (5 + rand() * 7));
        const boards = pressure > 80 ? 1 : 0;
        const { lastInsertRowid } = insertSession.run('seed', mode, hold * 2, pressure, boards, boards * ITEM_PRICES.keyboard, keys, offset);
        if (boards) insertSmash.run(lastInsertRowid, 'keyboard', boards);
      }
    }
  }
}

export function openDb({ fresh = false } = {}) {
  if (fresh) {
    for (const suffix of ['', '-shm', '-wal']) {
      if (existsSync(DB_PATH + suffix)) rmSync(DB_PATH + suffix);
    }
  }
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  const hasTables = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sessions'").get();
  let version = db.prepare('PRAGMA user_version').get().user_version;
  // Databases from before versioning existed report 0 but already have v1 tables.
  if (hasTables && version === 0) version = 1;

  if (!hasTables) {
    transaction(db, () => {
      db.exec(sql('schema.sql'));
      db.exec(sql('seed.sql'));
      for (let v = 2; v <= SCHEMA_VERSION; v++) if (MIGRATIONS[v].data) db.exec(sql(MIGRATIONS[v].data));
      seedDemoSessions(db);
    });
    console.log('[db] seeded fresh database at', DB_PATH);
  } else {
    for (let v = version + 1; v <= SCHEMA_VERSION; v++) {
      MIGRATIONS[v].upgrade(db);
      console.log(`[db] migrated to schema v${v}`);
    }
    db.exec(sql('schema.sql')); // no-op on an up-to-date DB; restores any missing index
  }
  db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  return db;
}

export { ITEM_PRICES };
