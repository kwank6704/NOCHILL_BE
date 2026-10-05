import { Router } from 'express';
import { ITEM_PRICES } from './db.js';

const MODES = new Set(['rage', 'shredder', 'mash']);
const SHRED_STYLES = new Set(['strip', 'cross', 'confetti']);
const ROAST_CATEGORIES = new Set(['too_short', 'too_long', 'spam', 'idle', 'empty', 'perfect', 'done', 'mash']);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function requireClientId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{6,64}$/.test(value)) {
    throw new HttpError(400, 'clientId ไม่ถูกต้อง');
  }
  return value;
}

function finiteNumber(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new HttpError(400, `${name} ต้องเป็นตัวเลข`);
  return n;
}

export function createRouter(db) {
  const r = Router();

  const q = {
    roastsAll: db.prepare('SELECT id, category, text, spice FROM roasts ORDER BY category, id'),
    roastRandom: db.prepare('SELECT id, category, text, spice FROM roasts WHERE category = ? ORDER BY RANDOM() LIMIT 1'),
    roastEvent: db.prepare('INSERT INTO roast_events (client_id, category) VALUES (?, ?)'),
    insertSession: db.prepare(`
      INSERT INTO sessions (client_id, mode, hold_ms, peak_pressure, items_destroyed, damage_baht, keystrokes)
      VALUES (?, ?, ?, ?, ?, ?, ?)`),
    insertSmash: db.prepare('INSERT INTO smashes (session_id, item, count) VALUES (?, ?, ?)'),
    insertGrievance: db.prepare(
      'INSERT INTO grievances (session_id, text, shred_style, is_public) VALUES (?, ?, ?, ?)',
    ),
    totals: db.prepare(`
      SELECT COUNT(*)                          AS sessions,
             COALESCE(SUM(items_destroyed), 0) AS itemsDestroyed,
             COALESCE(SUM(damage_baht), 0)     AS damageBaht,
             COALESCE(AVG(hold_ms), 0)         AS avgHoldMs,
             COALESCE(MAX(peak_pressure), 0)   AS maxPressure,
             COALESCE(AVG(peak_pressure), 0)   AS avgPressure,
             COALESCE(SUM(keystrokes), 0)      AS keystrokes
      FROM sessions WHERE (:cid IS NULL OR client_id = :cid)`),
    grievanceCount: db.prepare(`
      SELECT COUNT(*) AS n FROM grievances g
      LEFT JOIN sessions s ON s.id = g.session_id
      WHERE (:cid IS NULL OR s.client_id = :cid)`),
    roastCount: db.prepare('SELECT COUNT(*) AS n FROM roast_events WHERE (:cid IS NULL OR client_id = :cid)'),
    items: db.prepare(`
      SELECT item, SUM(count) AS count FROM smashes
      GROUP BY item ORDER BY count DESC`),
    daily: db.prepare(`
      SELECT date(created_at) AS day,
             SUM(mode = 'rage')     AS rage,
             SUM(mode = 'shredder') AS shredder,
             SUM(mode = 'mash')     AS mash
      FROM sessions WHERE created_at >= date('now', '-13 days')
      GROUP BY day ORDER BY day`),
    pressure: db.prepare(`
      SELECT MIN(CAST(peak_pressure / 10 AS INTEGER), 9) AS bucket, COUNT(*) AS n
      FROM sessions GROUP BY bucket ORDER BY bucket`),
    shame: db.prepare(`
      SELECT category, COUNT(*) AS n FROM roast_events
      GROUP BY category ORDER BY n DESC`),
    grievances: db.prepare(`
      SELECT id, text, shred_style AS style, created_at AS createdAt
      FROM grievances WHERE is_public = 1
      ORDER BY created_at DESC, id DESC LIMIT ?`),
  };

  r.get('/health', (_req, res) => res.json({ ok: true, chill: false }));

  r.get('/roasts', (_req, res) => {
    const grouped = {};
    for (const row of q.roastsAll.all()) (grouped[row.category] ??= []).push(row);
    res.json(grouped);
  });

  r.get('/roasts/random', (req, res) => {
    const category = String(req.query.category ?? '');
    if (!ROAST_CATEGORIES.has(category)) throw new HttpError(400, 'ไม่รู้จักหมวดคำแซะนี้');
    res.json(q.roastRandom.get(category) ?? null);
  });

  r.post('/roasts/events', (req, res) => {
    const clientId = requireClientId(req.body?.clientId);
    const category = String(req.body?.category ?? '');
    if (!ROAST_CATEGORIES.has(category)) throw new HttpError(400, 'ไม่รู้จักหมวดคำแซะนี้');
    q.roastEvent.run(clientId, category);
    res.status(201).json({ ok: true });
  });

  r.post('/sessions', (req, res) => {
    const body = req.body ?? {};
    const clientId = requireClientId(body.clientId);
    const mode = String(body.mode);
    if (!MODES.has(mode)) throw new HttpError(400, 'mode ต้องเป็น rage, shredder หรือ mash');

    const holdMs = Math.round(clamp(finiteNumber(body.holdMs, 'holdMs'), 0, 600_000));
    const peakPressure = clamp(finiteNumber(body.peakPressure, 'peakPressure'), 0, 100);

    // Damage is priced server-side; the client only reports what broke.
    const tally = {};
    if (mode === 'rage') {
      for (const [item, raw] of Object.entries(body.items ?? {})) {
        if (!(item in ITEM_PRICES) || item === 'docs') continue;
        const count = Math.round(clamp(Number(raw) || 0, 0, 50));
        if (count > 0) tally[item] = count;
      }
    } else if (mode === 'mash') {
      const boards = Math.round(clamp(Number(body.keyboards) || 0, 0, 50));
      if (boards > 0) tally.keyboard = boards;
    } else {
      tally.docs = 1;
    }

    // Nobody sustains more than ~40 keys/s — cap by duration so the stats stay sane.
    const keystrokes =
      mode === 'mash' ? Math.round(clamp(Number(body.keystrokes) || 0, 0, Math.max(40, (holdMs / 1000) * 40))) : 0;

    let grievance = null;
    if (mode === 'shredder') {
      const text = typeof body.grievance?.text === 'string' ? body.grievance.text.trim().slice(0, 140) : '';
      if (!text) throw new HttpError(400, 'จะย่อยอากาศเหรอ พิมพ์อะไรหน่อย');
      const style = SHRED_STYLES.has(body.grievance.style) ? body.grievance.style : 'strip';
      grievance = { text, style, isPublic: body.grievance.isPublic === true ? 1 : 0 };
    }

    const itemsDestroyed = Object.values(tally).reduce((a, b) => a + b, 0);
    const damageBaht = Object.entries(tally).reduce((a, [it, c]) => a + ITEM_PRICES[it] * c, 0);

    db.exec('BEGIN');
    let sessionId;
    try {
      sessionId = Number(
        q.insertSession.run(clientId, mode, holdMs, peakPressure, itemsDestroyed, damageBaht, keystrokes).lastInsertRowid,
      );
      for (const [item, count] of Object.entries(tally)) q.insertSmash.run(sessionId, item, count);
      if (grievance) q.insertGrievance.run(sessionId, grievance.text, grievance.style, grievance.isPublic);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    res.status(201).json({
      id: sessionId,
      itemsDestroyed,
      damageBaht,
      roast: q.roastRandom.get(mode === 'mash' && Math.random() < 0.5 ? 'mash' : 'done') ?? null,
    });
  });

  r.get('/stats', (req, res) => {
    const clientId = req.query.clientId ? requireClientId(String(req.query.clientId)) : null;
    const summarize = (id) => ({
      ...q.totals.get({ cid: id }),
      grievances: q.grievanceCount.get({ cid: id }).n,
      roasted: q.roastCount.get({ cid: id }).n,
    });

    // Fill gaps so the chart always shows 14 consecutive days.
    const byDay = new Map(q.daily.all().map((d) => [d.day, d]));
    const daily = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
      const row = byDay.get(d);
      daily.push({ day: d, rage: row?.rage ?? 0, shredder: row?.shredder ?? 0, mash: row?.mash ?? 0 });
    }

    const pressure = Array.from({ length: 10 }, () => 0);
    for (const { bucket, n } of q.pressure.all()) pressure[bucket] = n;

    res.json({
      global: summarize(null),
      me: clientId ? summarize(clientId) : null,
      items: q.items.all().map((row) => ({ ...row, price: ITEM_PRICES[row.item] ?? 0 })),
      daily,
      pressure,
      shame: q.shame.all(),
    });
  });

  r.get('/grievances', (req, res) => {
    const limit = Math.round(clamp(Number(req.query.limit) || 24, 1, 60));
    res.json(q.grievances.all(limit));
  });

  return r;
}

export function errorHandler(err, _req, res, _next) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON พัง' });
  console.error(err);
  res.status(500).json({ error: 'เซิร์ฟเวอร์ก็เครียดเหมือนกัน ลองใหม่อีกที' });
}
