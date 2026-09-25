import { createRideRouter } from "./rides/index.js";
import { createApp } from "./app.js";
import { db } from "./db.js";
import { env } from "./config.js";
import { loadAuthConfig } from "./auth/config.js";
import { createAuth } from "./auth/index.js";

const auth = await createAuth({
  ...loadAuthConfig(process.env),
  db,
  connectionString: env.DATABASE_URL,
});
const app = createApp(
  async () => {
    await db.$queryRaw`SELECT id FROM users LIMIT 1`;
  },
  auth,
  createRideRouter(db, auth),
  process.env.WEB_DIST_DIR,
);
const server = app.listen(env.PORT, "0.0.0.0", () => {
  console.info(JSON.stringify({ event: "api_started", port: env.PORT }));
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.once(signal, () => {
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    server.close(() => {
      void Promise.all([auth.close(), db.$disconnect()]).finally(() => {
        clearTimeout(timeout);
        process.exit(0);
      });
    });
  });
}
