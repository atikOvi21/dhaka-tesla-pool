import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { createApp } from '../app.js';
import { createAuth, type AuthRuntime, AUTH_LIFETIME_MS } from './index.js';
import { loadAuthConfig } from './config.js';
import { verifyPassword } from '../password.js';

const url = process.env.AUTH_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/dhaka_tesla_auth_test' || process.env.DATABASE_URL !== url) {
  throw new Error('Run via npm run test:auth against the isolated auth database.');
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
const origin = 'http://localhost:5173';
const secret = 'test-only-secret-'.repeat(4);
let auth: AuthRuntime;
let app: ReturnType<typeof createApp>;
const credentials = { email: 'nusrat@demo.dhaka.test', password: 'DemoOnly!Dhaka2026' };
const cookie = (response: request.Response) => {
  const values = response.headers['set-cookie'] as unknown as string[];
  expect(values).toBeDefined();
  return values.find(value => value.startsWith('dtp.sid='))!.split(';')[0]!;
};
const sid = (value: string) => decodeURIComponent(value.slice('dtp.sid='.length)).slice(2).split('.')[0]!;
async function bootstrap(target = app) {
  const response = await request(target).get('/api/v1/auth/csrf');
  expect(response.status).toBe(200);
  return { cookie: cookie(response), token: response.body.data.csrfToken as string };
}
async function login(account = credentials) {
  const anonymous = await bootstrap();
  const response = await request(app).post('/api/v1/auth/login').set('Origin', origin).set('Cookie', anonymous.cookie).set('X-CSRF-Token', anonymous.token).send(account);
  expect(response.status).toBe(200);
  return { anonymous, response, cookie: cookie(response) };
}
async function setup() {
  auth = await createAuth({ db, connectionString: url!, secret, origins: [origin], secureCookie: false, trustProxy: 0, credentialLimit: 1000 });
  auth.router.get('/test/passenger', auth.requireAuth, auth.requireRole('PASSENGER'), (_req, res) => res.json({ data: 'passenger' }));
  auth.router.get('/test/driver', auth.requireAuth, auth.requireRole('DRIVER'), (_req, res) => res.json({ data: 'driver' }));
  app = createApp(async () => {}, auth);
}
beforeAll(setup, 20000);
afterAll(async () => { await auth.close(); await db.$disconnect(); });

describe('backend authentication with real PostgreSQL sessions', () => {
  it('requires authentication and never saves an empty /me session', async () => {
    const response = await request(app).get('/api/v1/auth/me');
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('rejects missing/invalid CSRF for register, login and logout before authentication', async () => {
    const anonymous = await bootstrap();
    for (const endpoint of ['register', 'login', 'logout']) {
      for (const supplied of ['', '0'.repeat(64), 'x']) {
        const response = await request(app).post('/api/v1/auth/' + endpoint)
          .set('Origin', origin).set('Cookie', anonymous.cookie).set('X-CSRF-Token', supplied).send(credentials);
        expect(response.status).toBe(403);
        expect(response.body.error.code).toBe('CSRF_INVALID');
      }
    }
  });

  it('binds CSRF to session and requires an allowed Origin', async () => {
    const a = await bootstrap(), b = await bootstrap();
    for (const [sentOrigin, sentCookie, sentToken] of [
      [origin, b.cookie, a.token], ['https://evil.invalid', a.cookie, a.token], ['', a.cookie, a.token],
    ]) {
      const response = await request(app).post('/api/v1/auth/login')
        .set('Origin', sentOrigin!).set('Cookie', sentCookie!).set('X-CSRF-Token', sentToken!).send(credentials);
      expect(response.status).toBe(403);
    }
    expect((await request(app).get('/api/v1/auth/csrf').set('Origin', 'https://evil.invalid')).status).toBe(403);
    expect((await request(app).get('/api/v1/auth/csrf').set('Sec-Fetch-Site', 'cross-site')).status).toBe(403);
  });

  it('registers a passenger, normalizes email/name, preserves password and stores only a hash', async () => {
    const anonymous = await bootstrap();
    const email = randomUUID() + '@test.invalid';
    const password = '  Exact Password 2026  ';
    const response = await request(app).post('/api/v1/auth/register')
      .set('Origin', origin).set('Cookie', anonymous.cookie).set('X-CSRF-Token', anonymous.token)
      .send({ name: '  Test passenger  ', email: ' ' + email.toUpperCase() + ' ', password });
    expect(response.status).toBe(201);
    expect(response.body.data).toEqual({ id: expect.any(String), email, name: 'Test passenger', role: 'PASSENGER' });
    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.password_hash).not.toBe(password);
    expect(await verifyPassword(password, user.password_hash)).toBe(true);
    expect(await verifyPassword(password.trim(), user.password_hash)).toBe(false);
    const authenticatedCookie = cookie(response);
    expect(authenticatedCookie).not.toBe(anonymous.cookie);
    expect(await db.session.findUnique({ where: { sid: sid(anonymous.cookie) } })).toBeNull();
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', authenticatedCookie)).body.data).toEqual(response.body.data);
  }, 15000);

  it('rejects role injection, unknown fields and invalid input', async () => {
    const anonymous = await bootstrap();
    for (const data of [
      { name: 'Test', ...credentials, role: 'DRIVER' },
      { name: 'Test', ...credentials, passengerId: randomUUID() },
      { name: '', ...credentials }, { name: 'Test', ...credentials, email: 'bad' },
      { name: 'Test', ...credentials, password: 'short' },
      { name: 'Test', ...credentials, password: 'a'.repeat(129) },
    ]) {
      const response = await request(app).post('/api/v1/auth/register').set('Origin', origin)
        .set('Cookie', anonymous.cookie).set('X-CSRF-Token', anonymous.token).send(data);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('resolves concurrent duplicate normalized emails through the database constraint', async () => {
    const a = await bootstrap(), b = await bootstrap();
    const email = randomUUID() + '@test.invalid';
    const responses = await Promise.all([a, b].map((anonymous, index) =>
      request(app).post('/api/v1/auth/register').set('Origin', origin)
        .set('Cookie', anonymous.cookie).set('X-CSRF-Token', anonymous.token)
        .send({ name: 'Concurrent passenger', email: index ? email.toUpperCase() : email, password: credentials.password })));
    expect(responses.map(value => value.status).sort()).toEqual([201, 409]);
    expect(responses.find(value => value.status === 409)!.body.error.code).toBe('EMAIL_UNAVAILABLE');
    expect(await db.user.count({ where: { email } })).toBe(1);
  }, 15000);

  it('logs in seeded passenger and driver, enforcing both role boundaries', async () => {
    for (const [name, role, allowed, denied] of [
      ['nusrat', 'PASSENGER', 'passenger', 'driver'], ['jashim', 'DRIVER', 'driver', 'passenger'],
    ]) {
      const authenticated = await login({ ...credentials, email: name + '@demo.dhaka.test' });
      expect(authenticated.response.body.data.role).toBe(role);
      expect(Object.keys(authenticated.response.body.data).sort()).toEqual(['email','id','name','role']);
      expect((await request(app).get('/api/v1/auth/test/' + allowed).set('Cookie', authenticated.cookie)).status).toBe(200);
      expect((await request(app).get('/api/v1/auth/test/' + denied).set('Cookie', authenticated.cookie)).status).toBe(403);
    }
    expect((await request(app).get('/api/v1/auth/test/driver')).status).toBe(401);
  }, 15000);

  it('returns identical generic errors for unknown email and wrong password', async () => {
    const anonymous = await bootstrap();
    const errors = [];
    for (const data of [{ ...credentials, password: 'WrongPassword2026' }, { ...credentials, email: 'missing@test.invalid' }]) {
      const response = await request(app).post('/api/v1/auth/login').set('Origin', origin)
        .set('Cookie', anonymous.cookie).set('X-CSRF-Token', anonymous.token).send(data);
      expect(response.status).toBe(401);
      errors.push(response.body);
    }
    expect(errors[0]).toEqual(errors[1]);
    expect(errors[0]).toEqual({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
  }, 15000);

  it('rotates session/token at login; old token fails and a freshly fetched token allows logout', async () => {
    const authenticated = await login();
    expect(authenticated.cookie).not.toBe(authenticated.anonymous.cookie);
    expect(await db.session.findUnique({ where: { sid: sid(authenticated.anonymous.cookie) } })).toBeNull();
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', authenticated.anonymous.cookie)).status).toBe(401);
    const stale = await request(app).post('/api/v1/auth/logout').set('Origin', origin)
      .set('Cookie', authenticated.cookie).set('X-CSRF-Token', authenticated.anonymous.token);
    expect(stale.status).toBe(403);
    const fresh = await request(app).get('/api/v1/auth/csrf').set('Cookie', authenticated.cookie);
    expect(fresh.body.data.csrfToken).not.toBe(authenticated.anonymous.token);
    const result = await request(app).post('/api/v1/auth/logout').set('Origin', origin)
      .set('Cookie', authenticated.cookie).set('X-CSRF-Token', fresh.body.data.csrfToken).send({});
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ data: null });
    expect(result.headers['set-cookie'][0]).toMatch(/dtp.sid=; Path=\/; Expires=Thu, 01 Jan 1970.*HttpOnly.*SameSite=Lax/);
    expect(await db.session.findUnique({ where: { sid: sid(authenticated.cookie) } })).toBeNull();
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', authenticated.cookie)).status).toBe(401);
  });

  it('persists a fixed eight-hour session across API/store reconstruction', async () => {
    const authenticated = await login();
    const stored = await db.session.findUniqueOrThrow({ where: { sid: sid(authenticated.cookie) } });
    expect(stored.expire.getTime() - Date.now()).toBeGreaterThan(AUTH_LIFETIME_MS - 10000);
    expect(stored.expire.getTime() - Date.now()).toBeLessThanOrEqual(AUTH_LIFETIME_MS + 1000); // store rounds up to whole seconds
    expect((stored.sess as { authExpiresAt: number }).authExpiresAt - Date.now()).toBeLessThanOrEqual(AUTH_LIFETIME_MS);
    await auth.close();
    await setup();
    const response = await request(app).get('/api/v1/auth/me').set('Cookie', authenticated.cookie);
    expect(response.status).toBe(200);
    expect(response.body.data.email).toBe(credentials.email);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect((await db.session.findUniqueOrThrow({ where: { sid: stored.sid } })).expire).toEqual(stored.expire);
  }, 15000);

  it('rejects expired DB sessions even when a client replays the cookie and prunes expired rows', async () => {
    const authenticated = await login();
    const id = sid(authenticated.cookie);
    await db.session.update({ where: { sid: id }, data: { expire: new Date(Date.now() - 60000) } });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', authenticated.cookie)).status).toBe(401);
    await new Promise<void>((resolve, reject) => auth.store.pruneSessions(error => error ? reject(error) : resolve()));
    expect(await db.session.findUnique({ where: { sid: id } })).toBeNull();
  });

  it('rejects application expiry even if store expiry was extended', async () => {
    const authenticated = await login();
    const id = sid(authenticated.cookie);
    const row = await db.session.findUniqueOrThrow({ where: { sid: id } });
    await db.session.update({ where: { sid: id }, data: { sess: { ...(row.sess as object), authExpiresAt: Date.now() - 1000 } } });
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', authenticated.cookie)).status).toBe(401);
    expect(await db.session.findUnique({ where: { sid: id } })).toBeNull();
  });

  it('rejects tampered session cookies', async () => {
    const authenticated = await login();
    expect((await request(app).get('/api/v1/auth/me').set('Cookie', authenticated.cookie + 'tampered')).status).toBe(401);
  });

  it('shares the documented ten-attempt credential limit across login and registration', async () => {
    const limited = await createAuth({ db, connectionString: url!, secret, origins: [origin], secureCookie: false, trustProxy: 0 });
    try {
      const target = createApp(async () => {}, limited);
      const anonymous = await bootstrap(target);
      for (let i = 0; i < 11; i++) {
        const response = await request(target).post('/api/v1/auth/login').set('Origin', origin)
          .set('Cookie', anonymous.cookie).set('X-CSRF-Token', anonymous.token).send({});
        expect(response.status).toBe(i < 10 ? 400 : 429);
        if (i === 10) expect(response.headers['retry-after']).toBeDefined();
      }
      const blocked = await request(target).post('/api/v1/auth/register').set('Origin', origin)
        .set('Cookie', anonymous.cookie).set('X-CSRF-Token', anonymous.token).send({});
      expect(blocked.status).toBe(429);
    } finally { await limited.close(); }
  });

  it('limits anonymous CSRF session creation', async () => {
    const limited = await createAuth({ db, connectionString: url!, secret, origins: [origin], secureCookie: false, trustProxy: 0, bootstrapLimit: 2 });
    try {
      const target = createApp(async () => {}, limited);
      expect((await request(target).get('/api/v1/auth/csrf')).status).toBe(200);
      expect((await request(target).get('/api/v1/auth/csrf')).status).toBe(200);
      expect((await request(target).get('/api/v1/auth/csrf')).status).toBe(429);
    } finally { await limited.close(); }
  });

  it('sets secure cookies only over deliberately trusted HTTPS proxy configuration', async () => {
    const secure = await createAuth({ db, connectionString: url!, secret, origins: ['https://app.test'], secureCookie: true, trustProxy: 1 });
    try {
      const target = createApp(async () => {}, secure);
      const response = await request(target).get('/api/v1/auth/csrf').set('X-Forwarded-Proto', 'https');
      expect(response.headers['set-cookie'][0]).toMatch(/HttpOnly; Secure; SameSite=Lax/);
      expect((await request(target).get('/api/v1/auth/csrf')).headers['set-cookie']).toBeUndefined();
    } finally { await secure.close(); }
    expect(() => loadAuthConfig({ SESSION_SECRET: secret, AUTH_ORIGINS: 'http://public.example', SESSION_COOKIE_SECURE: 'false' })).toThrow();
    expect(() => loadAuthConfig({ SESSION_SECRET: 'replace-with-a-secret-at-least-32-chars' })).toThrow();
    expect(loadAuthConfig({ SESSION_SECRET: secret, NODE_ENV: 'production', AUTH_ORIGINS: 'https://app.test' }).secureCookie).toBe(true);
  });

  it('returns safe errors and never logs submitted credentials on malformed input', async () => {
    const response = await request(app).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"password":');
    expect(response.status).toBe(400);
    expect(response.body).toEqual({ error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON body.' } });
    expect(await verifyPassword('irrelevant', 'malformed-hash')).toBe(false);
  });

  it('fails closed with a generic server error when the session store cannot be read', async () => {
    const authenticated = await login();
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const get = vi.spyOn(auth.store, 'get').mockImplementation((_id, callback) => { callback(new Error('private-database-details')); });
    try {
      const response = await request(app).get('/api/v1/auth/me').set('Cookie', authenticated.cookie);
      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(response.body)).not.toContain('private-database-details');
      expect(JSON.stringify(log.mock.calls)).not.toContain('private-database-details');
      expect(response.headers['set-cookie']).toBeUndefined();
    } finally { get.mockRestore(); log.mockRestore(); }
  });

  it('rechecks account role from PostgreSQL rather than trusting a stale session role', async () => {
    const anonymous = await bootstrap();
    const response = await request(app).post('/api/v1/auth/register').set('Origin', origin)
      .set('Cookie', anonymous.cookie).set('X-CSRF-Token', anonymous.token)
      .send({ name: 'Role change fixture', email: randomUUID() + '@test.invalid', password: credentials.password });
    expect(response.status).toBe(201);
    const authCookie = cookie(response);
    await db.user.update({ where: { id: response.body.data.id }, data: { role: 'DRIVER' } });
    expect((await request(app).get('/api/v1/auth/test/passenger').set('Cookie', authCookie)).status).toBe(403);
    expect((await request(app).get('/api/v1/auth/test/driver').set('Cookie', authCookie)).status).toBe(200);
  });
});
