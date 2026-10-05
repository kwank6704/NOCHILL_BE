// Local / long-running entry point. On Vercel, api/index.js serves the same app.
import app, { getDb } from './app.js';

const PORT = Number(process.env.PORT ?? 4000);

const { storage } = await getDb();
const server = app.listen(PORT, () => {
  console.log(`[api] NO CHILL backend → http://localhost:${PORT}/api (${storage})`);
});

const shutdown = async () => {
  server.close();
  (await getDb()).db.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
