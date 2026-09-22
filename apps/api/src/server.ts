import { createApp } from './app.js';
import { db } from './db.js';
import { env } from './config.js';

const app = createApp(async () => { await db.$queryRaw`SELECT id FROM users LIMIT 1`; });
const server = app.listen(env.PORT, '0.0.0.0', () => {
  console.info(JSON.stringify({ event: 'api_started', port: env.PORT }));
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => { void db.$disconnect().finally(() => { clearTimeout(timeout); process.exit(0); }); });
  });
}
