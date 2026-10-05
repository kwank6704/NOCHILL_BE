-- ============================================================
--  NO CHILL — Anti-Mindfulness database schema (SQLite)
--  Latest shape of every table. Existing databases are upgraded by
--  src/db.js; the `meta` table tracks the schema version (Turso-friendly,
--  unlike PRAGMA user_version). Connection PRAGMAs live in db.js.
-- ============================================================

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- คำด่าแทนใจของโค้ช (Passive Aggressive Breathing)
CREATE TABLE IF NOT EXISTS roasts (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  category  TEXT    NOT NULL CHECK (category IN
              ('too_short','too_long','spam','idle','empty','perfect','done','mash')),
  text      TEXT    NOT NULL,
  spice     INTEGER NOT NULL DEFAULT 2 CHECK (spice BETWEEN 1 AND 3)
);
CREATE INDEX IF NOT EXISTS idx_roasts_category ON roasts(category);

-- หนึ่งรอบของการ "หายใจ" = หนึ่ง session
CREATE TABLE IF NOT EXISTS sessions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id       TEXT    NOT NULL,
  mode            TEXT    NOT NULL CHECK (mode IN ('rage','shredder','mash')),
  hold_ms         INTEGER NOT NULL CHECK (hold_ms >= 0),
  peak_pressure   REAL    NOT NULL CHECK (peak_pressure BETWEEN 0 AND 100),
  items_destroyed INTEGER NOT NULL DEFAULT 0,
  damage_baht     INTEGER NOT NULL DEFAULT 0,
  keystrokes      INTEGER NOT NULL DEFAULT 0,   -- mash mode: ปุ่มที่ถูกรัว
  created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sessions_client  ON sessions(client_id);
CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at);

-- ของที่ถูกปาแตกในแต่ละ session (แยกตามชนิด)
CREATE TABLE IF NOT EXISTS smashes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  item        TEXT    NOT NULL,
  count       INTEGER NOT NULL CHECK (count > 0)
);
CREATE INDEX IF NOT EXISTS idx_smashes_session ON smashes(session_id);

-- ความในใจที่ถูกส่งเข้าเครื่องย่อย (Shredder Breathing)
CREATE TABLE IF NOT EXISTS grievances (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER REFERENCES sessions(id) ON DELETE CASCADE,
  text        TEXT    NOT NULL,
  shred_style TEXT    NOT NULL DEFAULT 'strip' CHECK (shred_style IN ('strip','cross','confetti')),
  is_public   INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_grievances_public ON grievances(is_public, created_at);

-- บันทึกว่าโดนโค้ชแซะไปกี่ที
CREATE TABLE IF NOT EXISTS roast_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   TEXT    NOT NULL,
  category    TEXT    NOT NULL,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_roast_events_client ON roast_events(client_id);
