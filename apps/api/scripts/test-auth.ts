import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
config({ path: '../../.env', quiet: true });
const target = process.env.AUTH_TEST_DATABASE_URL;
if (!target || new URL(target).pathname !== '/dhaka_tesla_auth_test'
    || (process.env.DATABASE_URL && new URL(process.env.DATABASE_URL).pathname === new URL(target).pathname)) {
  throw new Error('Set AUTH_TEST_DATABASE_URL to the isolated dhaka_tesla_auth_test database, never the development database.');
}
const testEnv = { ...process.env, DATABASE_URL: target, NODE_ENV: 'test', SEED_DEMO: 'true' };
for (const args of [
  [resolve('../../node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma7.config.ts'],
  [resolve('../../node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts'],
  [resolve('../../node_modules/vitest/vitest.mjs'), 'run', 'src/auth/auth.integration.test.ts', '--maxWorkers=1'],
]) {
  const result = spawnSync(process.execPath, args, { env: testEnv, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
