import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const base = process.env.AUTH_SMOKE_ORIGIN ?? 'http://localhost:8080';
if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('This demo smoke check is for local Compose only.');
async function call(path, { cookie, token, data, method = 'GET' } = {}) {
  const response = await fetch(base + '/api/v1/auth' + path, {
    method, signal: AbortSignal.timeout(5000),
    headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(token ? { 'X-CSRF-Token': token } : {}), ...(data ? { 'Content-Type': 'application/json' } : {}) },
    body: data ? JSON.stringify(data) : undefined,
  });
  return { status: response.status, body: await response.json(), cookies: response.headers.getSetCookie() };
}
const cookieFrom = response => response.cookies.find(value => value.startsWith('dtp.sid=')).split(';')[0];
async function login(name, role) {
  const anonymous = await call('/csrf');
  assert.equal(anonymous.status, 200);
  assert.match(anonymous.cookies[0], /HttpOnly/);
  assert.match(anonymous.cookies[0], /SameSite=Lax/);
  const response = await call('/login', { method: 'POST', cookie: cookieFrom(anonymous), token: anonymous.body.data.csrfToken, data: { email: name + '@demo.dhaka.test', password: 'DemoOnly!Dhaka2026' } });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.role, role);
  assert.notEqual(cookieFrom(response), cookieFrom(anonymous));
  return cookieFrom(response);
}
async function logout(cookie) {
  const csrf = await call('/csrf', { cookie });
  const response = await call('/logout', { method: 'POST', cookie, token: csrf.body.data.csrfToken, data: {} });
  assert.equal(response.status, 200);
  assert.match(response.cookies[0], /dtp.sid=;/);
  assert.equal((await call('/me', { cookie })).status, 401);
}
assert.equal((await call('/me')).status, 401);
assert.equal((await call('/login', { method: 'POST', data: {} })).status, 403);
const passenger = await login('nusrat', 'PASSENGER');
const driver = await login('jashim', 'DRIVER');
await logout(driver);
assert.equal((await call('/me', { cookie: passenger })).body.data.email, 'nusrat@demo.dhaka.test');
const restarted = spawnSync('docker', ['compose', 'restart', 'api'], { encoding: 'utf8' });
if (restarted.error || restarted.status !== 0) throw new Error('Could not restart API container.');
let ready = false;
for (let attempt = 0; attempt < 40; attempt++) {
  try { ready = (await fetch(base + '/api/v1/health/ready', { signal: AbortSignal.timeout(2000) })).ok; } catch {}
  if (ready) break;
  await delay(500);
}
assert.equal(ready, true, 'API must become ready after restart');
const restored = await call('/me', { cookie: passenger });
assert.equal(restored.status, 200);
assert.equal(restored.body.data.email, 'nusrat@demo.dhaka.test');
await logout(passenger);
console.log('PASS: Compose passenger/driver login, CSRF, cookie flags, session rotation, actual API restart persistence, and logout invalidation.');
