import { readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DB_DIR = path.resolve(here, '../database');
export const DB_PATH = process.env.NOCHILL_DB ?? path.join(DB_DIR, 'nochill.db');

const ITEM_PRICES = { plate: 120, mug: 250, keyboard: 2490, phone: 18900, docs: 0 };

/** Bump when schema.sql changes shape; add a step to MIGRATIONS below. */
const SCHEMA_VERSION = 2;

const sql = (file) => readFileSync(path.join(DB_DIR, file), 'utf8');

/**
 * Where the data lives:
 *  - TURSO_DATABASE_URL set → Turso (libSQL over HTTP), used in production.
 *  - on Vercel without Turso → a throwaway SQLite file in /tmp (resets on cold start).
 *  - otherwise → database/nochill.db on disk.
 */
function resolveTarget() {
  if (process.env.TURSO_DATABASE_URL) return { url: process.env.TURSO_DATABASE_URL, storage: 'turso' };
  if (process.env.VERCEL) {
    const file = path.join(tmpdir(), 'nochill.db'); // /tmp is the only writable dir on Vercel
    return { url: `file:${file.replace(/\\/g, '/')}`, storage: 'ephemeral', file };
  }
  return { url: `file:${DB_PATH.replace(/\\/g, '/')}`, storage: 'file', file: DB_PATH };
}

/**
 * Upgrade steps for databases created by an older version. `data` files also
 * run on fresh databases so seed content lives in exactly one place.
 */
const MIGRATIONS = {
  2: {
    // v1 → v2: 'mash' mode + roast category (CHECK constraints) and a keystrokes column.
    // SQLite can't alter a CHECK, so rebuild the two tables and copy the rows across.
    async upgrade(db) {
      await db.execute('PRAGMA foreign_keys = OFF');
      // Keep FKs in smashes/grievances pointing at "sessions" while we swap tables.
      await db.execute('PRAGMA legacy_alter_table = ON');
      try {
        await db.executeMultiple(`
          BEGIN;
          DROP INDEX IF EXISTS idx_sessions_client;
          DROP INDEX IF EXISTS idx_sessions_created;
          DROP INDEX IF EXISTS idx_roasts_category;
          ALTER TABLE sessions RENAME TO _sessions_v1;
          ALTER TABLE roasts RENAME TO _roasts_v1;
          ${sql('schema.sql')}
          INSERT INTO sessions (id, client_id, mode, hold_ms, peak_pressure, items_destroyed, damage_baht, created_at)
            SELECT id, client_id, mode, hold_ms, peak_pressure, items_destroyed, damage_baht, created_at FROM _sessions_v1;
          INSERT INTO roasts (id, category, text, spice)
            SELECT id, category, text, spice FROM _roasts_v1;
          DROP TABLE _sessions_v1;
          DROP TABLE _roasts_v1;
          ${sql('migrations/002_mash_roasts.sql')}
          COMMIT;
        `);
      } catch (err) {
        await db.execute('ROLLBACK').catch(() => {});
        throw err;
      } finally {
        await db.execute('PRAGMA legacy_alter_table = OFF');
        await db.execute('PRAGMA foreign_keys = ON');
      }
    },
    data: 'migrations/002_mash_roasts.sql',
  },
};

async function hasTable(db, name) {
  const rs = await db.execute({ sql: "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", args: [name] });
  return rs.rows.length > 0;
}

async function readVersion(db) {
  if (await hasTable(db, 'meta')) {
    const rs = await db.execute("SELECT value FROM meta WHERE key = 'schema_version'");
    if (rs.rows.length) return Number(rs.rows[0].value);
  }
  if (!(await hasTable(db, 'sessions'))) return 0;
  // Databases from the node:sqlite era tracked the version in PRAGMA user_version.
  try {
    const rs = await db.execute('PRAGMA user_version');
    return Number(rs.rows[0]?.user_version ?? 0) || 1;
  } catch {
    return 1;
  }
}

const versionStatement = (v) => ({
  sql: "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  args: [String(v)],
});

/** Two weeks of demo activity so charts aren't empty on first run — one batch, one round trip. */
function demoSessionStatements() {
  let s = 42;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const items = Object.keys(ITEM_PRICES).filter((k) => k !== 'docs');
  const stmts = [];
  let id = 0;
  const session = (mode, hold, pressure, n, damage, keys, offset) =>
    stmts.push({
      sql: `INSERT INTO sessions (id, client_id, mode, hold_ms, peak_pressure, items_destroyed, damage_baht, keystrokes, created_at)
            VALUES (?, 'seed', ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
      args: [++id, mode, hold, pressure, n, damage, keys, offset],
    });
  const smash = (item, count) => stmts.push({ sql: 'INSERT INTO smashes (session_id, item, count) VALUES (?, ?, ?)', args: [id, item, count] });

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
        session(mode, hold, pressure, n, damage, 0, offset);
        for (const [it, c] of Object.entries(tally)) smash(it, c);
      } else if (mode === 'shredder') {
        session(mode, hold, pressure, 1, 0, 0, offset);
        smash('docs', 1);
      } else {
        const keys = Math.round((hold / 1000) * (5 + rand() * 7));
        const boards = pressure > 80 ? 1 : 0;
        session(mode, hold * 2, pressure, boards, boards * ITEM_PRICES.keyboard, keys, offset);
        if (boards) smash('keyboard', boards);
      }
    }
  }
  return stmts;
}

/** Opens (and creates/seeds/migrates if needed) the database. Resolves to { db, storage }. */
export async function openDb({ fresh = false } = {}) {
  const target = resolveTarget();
  if (fresh && target.file) {
    for (const suffix of ['', '-shm', '-wal']) {
      if (existsSync(target.file + suffix)) rmSync(target.file + suffix);
    }
  }

  // Local files use the native SQLite binding; remote URLs use the pure-JS HTTP client.
  const { createClient } = target.file ? await import('@libsql/client/sqlite3') : await import('@libsql/client/http');
  const db = createClient({ url: target.url, authToken: process.env.TURSO_AUTH_TOKEN, intMode: 'number' });
  if (target.file) {
    await db.execute('PRAGMA journal_mode = WAL');
    await db.execute('PRAGMA foreign_keys = ON');
  }

  const version = await readVersion(db);
  if (version === 0) {
    const data = [];
    for (let v = 2; v <= SCHEMA_VERSION; v++) if (MIGRATIONS[v].data) data.push(sql(MIGRATIONS[v].data));
    await db.executeMultiple(`BEGIN;\n${sql('schema.sql')}\n${sql('seed.sql')}\n${data.join('\n')}\nCOMMIT;`);
    // Demo rows + the version stamp land together, so a half-seeded DB is never marked current.
    await db.batch([...demoSessionStatements(), versionStatement(SCHEMA_VERSION)], 'write');
    console.log(`[db] seeded fresh ${target.storage} database`);
  } else {
    for (let v = version + 1; v <= SCHEMA_VERSION; v++) {
      await MIGRATIONS[v].upgrade(db);
      console.log(`[db] migrated to schema v${v}`);
    }
    await db.executeMultiple(sql('schema.sql')); // no-op when current; adds meta / missing indexes
    await db.execute(versionStatement(SCHEMA_VERSION));
  }
  if (target.storage === 'ephemeral') console.warn('[db] TURSO_DATABASE_URL not set — using a temporary database that resets');
  return { db, storage: target.storage };
}

export { ITEM_PRICES };
