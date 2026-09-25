import { config } from 'dotenv';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
config({ path: '.env', quiet: true });
const target = process.env.AUTH_TEST_DATABASE_URL;
if (!target || new URL(target).pathname !== '/dhaka_tesla_auth_test' || target === process.env.DATABASE_URL) {
  throw new Error('Use AUTH_TEST_DATABASE_URL for the disposable dhaka_tesla_auth_test database.');
}
const origin = 'https://hosted.test';
const base = 'http://127.0.0.1:3082';
const child = spawn(process.execPath, ['scripts/start-hosted.mjs'], {
  env: { ...process.env, DATABASE_URL: target, SESSION_SECRET: randomBytes(48).toString('hex'),
    AUTH_ORIGINS: origin, SESSION_COOKIE_SECURE: 'true', TRUST_PROXY_HOPS: '1',
    NODE_ENV: 'production', WEB_DIST_DIR: 'apps/web/dist', SEED_DEMO: 'true', PORT: '3082' },
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let startup = '';
child.stdout.on('data', data => { startup += data; });
child.stderr.on('data', data => { startup += data; });
let cookie = '';
async function call(path, options = {}) {
  return fetch(base + path, { ...options, signal: AbortSignal.timeout(5000), headers: {
    'X-Forwarded-Proto': 'https', ...(cookie ? { Cookie: cookie } : {}), ...options.headers,
  } });
}
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (child.exitCode !== null) throw new Error('Hosted startup exited: ' + startup);
    try { if ((await call('/api/v1/health/ready')).ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'Hosted server must become ready');
  for (const path of ['/login', '/passenger/history', '/driver/trips/example', '/foundation']) {
    const response = await call(path);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /<div id="root">/);
  }
  assert.equal((await call('/api/missing')).status, 404);
  assert.equal((await call('/api/v1/auth/me')).status, 401);
  const csrf = await call('/api/v1/auth/csrf');
  const initialCookie = csrf.headers.get('set-cookie');
  assert.match(initialCookie, /; Secure/);
  assert.match(initialCookie, /; HttpOnly/);
  cookie = initialCookie.split(';')[0];
  let token = (await csrf.json()).data.csrfToken;
  const login = await call('/api/v1/auth/login', { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': token,
  }, body: JSON.stringify({ email: 'nusrat@demo.dhaka.test', password: 'DemoOnly!Dhaka2026' }) });
  assert.equal(login.status, 200);
  const authenticatedCookie = login.headers.get('set-cookie');
  assert.match(authenticatedCookie, /; Secure/);
  assert.notEqual(authenticatedCookie.split(';')[0], cookie);
  cookie = authenticatedCookie.split(';')[0];
  assert.equal((await (await call('/api/v1/auth/me')).json()).data.role, 'PASSENGER');
  token = (await (await call('/api/v1/auth/csrf')).json()).data.csrfToken;
  const options = { method: 'POST', headers: { Origin: 'https://wrong.test', 'X-CSRF-Token': token, 'Content-Type': 'application/json' }, body: '{}' };
  assert.equal((await call('/api/v1/auth/logout', options)).status, 403);
  options.headers.Origin = origin;
  assert.equal((await call('/api/v1/auth/logout', options)).status, 200);
  assert.equal((await call('/api/v1/auth/me')).status, 401);
  console.log('Hosted startup, migrations/seed, SPA deep links, Secure cookie rotation, session, CSRF origin and logout passed (simulated trusted TLS proxy; not a public deployment).');
} finally {
  if (child.exitCode === null) {
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill();
    await closed;
  }
}
