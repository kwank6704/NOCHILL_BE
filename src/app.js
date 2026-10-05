import express from 'express';
import cors from 'cors';
import { openDb } from './db.js';
import { createRouter, errorHandler } from './routes.js';

// Opened lazily and shared; a failed open is retried on the next request
// (important on serverless, where one bad cold start shouldn't poison the instance).
let pending = null;
export function getDb() {
  pending ??= openDb().catch((err) => {
    pending = null;
    throw err;
  });
  return pending;
}

const origins = (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim());

const app = express();
app.disable('x-powered-by');
app.use(cors({ origin: origins }));
app.use(express.json({ limit: '16kb' }));
app.use('/api', createRouter(getDb));
app.use((_req, res) => res.status(404).json({ error: 'ไม่มีหน้านี้ เหมือนความอดทนของคุณ' }));
app.use(errorHandler);

export default app;
