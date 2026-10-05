import express from 'express';
import cors from 'cors';
import { openDb } from './db.js';
import { createRouter, errorHandler } from './routes.js';

const PORT = Number(process.env.PORT ?? 4000);
const ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:3000';

const db = openDb();
const app = express();

app.disable('x-powered-by');
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: '16kb' }));
app.use('/api', createRouter(db));
app.use((_req, res) => res.status(404).json({ error: 'ไม่มีหน้านี้ เหมือนความอดทนของคุณ' }));
app.use(errorHandler);

const server = app.listen(PORT, () => {
  console.log(`[api] NO CHILL backend → http://localhost:${PORT}/api`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
