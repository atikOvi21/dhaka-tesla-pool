// Run from repository root. Render Free has no pre-deploy command.
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
if (!process.env.DATABASE_URL || !process.env.SESSION_SECRET || !process.env.AUTH_ORIGINS) {
  throw new Error('Set DATABASE_URL, SESSION_SECRET and AUTH_ORIGINS in the hosting dashboard.');
}
const commands = [[resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy', '--config', 'prisma7.config.ts']];
if (process.env.SEED_DEMO === 'true') commands.push([resolve('node_modules/tsx/dist/cli.mjs'), 'prisma/seed.ts']);
for (const args of commands) {
  const result = spawnSync(process.execPath, args, { cwd: resolve('apps/api'), env: process.env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
await import('../apps/api/dist/server.js');
