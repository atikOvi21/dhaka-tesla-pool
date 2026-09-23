import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import pg from 'pg';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import { AuthError, createAuthService, type SafeUser } from './service.js';

declare module 'express-session' {
  interface SessionData { userId?: string; csrfToken?: string; authExpiresAt?: number; }
}
declare global {
  namespace Express { interface Request { currentUser?: SafeUser; } }
}

export type AuthOptions = {
  db: PrismaClient; connectionString: string; secret: string; origins: string[];
  secureCookie: boolean; trustProxy: 0 | 1;
  // Test seams keep production settings fixed at the composition root.
  credentialLimit?: number; bootstrapLimit?: number;
};
export const AUTH_LIFETIME_MS = 8 * 60 * 60 * 1000;
export const ANONYMOUS_LIFETIME_MS = 60 * 60 * 1000;
export const COOKIE_NAME = 'dtp.sid';
const PgStore = connectPgSimple(session);
const email = z.string().trim().toLowerCase().max(254).email();
const password = z.string().min(12).max(128); // preserve whitespace / Unicode exactly
const loginInput = z.object({ email, password }).strict();
const registerInput = loginInput.extend({ name: z.string().trim().min(1).max(100) }).strict();
const token = () => randomBytes(32).toString('hex');
const save = (req: Request) => new Promise<void>((resolve, reject) => req.session.save(error => error ? reject(error) : resolve()));
const regenerate = (req: Request) => new Promise<void>((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
const destroy = (req: Request) => new Promise<void>((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));

export async function createAuth(options: AuthOptions) {
  const service = await createAuthService(options.db);
  const pool = new pg.Pool({ connectionString: options.connectionString, max: 5, connectionTimeoutMillis: 2000, query_timeout: 3000 });
  const store = new PgStore({
    pool, tableName: 'sessions', createTableIfMissing: false,
    disableTouch: true, pruneSessionInterval: 15 * 60,
    errorLog: () => console.error(JSON.stringify({ event: 'session_store_failed' })),
  });
  pool.on('error', () => console.error(JSON.stringify({ event: 'session_pool_failed' })));
  const cookie = { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: options.secureCookie };
  const sessionMiddleware = session({
    name: COOKIE_NAME, secret: options.secret, store, resave: false,
    saveUninitialized: false, rolling: false, cookie: { ...cookie, maxAge: ANONYMOUS_LIFETIME_MS },
  });
  const clearCookie = (res: Response) => res.clearCookie(COOKIE_NAME, cookie);
  const expire: RequestHandler = async (req, res, next) => {
    if (req.session.userId && (!req.session.authExpiresAt || req.session.authExpiresAt <= Date.now())) {
      await destroy(req);
      clearCookie(res);
      throw new AuthError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    }
    next();
  };
  const csrf: RequestHandler = (req, _res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) { next(); return; }
    const supplied = req.get('X-CSRF-Token');
    const expected = req.session.csrfToken;
    if (!options.origins.includes(req.get('Origin') ?? '') || req.get('Sec-Fetch-Site') === 'cross-site'
        || !supplied || !expected || !/^[0-9a-f]{64}$/.test(supplied)
        || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
      throw new AuthError(403, 'CSRF_INVALID', 'Refresh the security token and try again.');
    }
    next();
  };
  const requireAuth: RequestHandler = async (req, _res, next) => {
    if (!req.session.userId) throw new AuthError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    const user = await service.findUser(req.session.userId);
    if (!user) throw new AuthError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    req.currentUser = user;
    next();
  };
  const requireRole = (role: SafeUser['role']): RequestHandler => (req, _res, next) => {
    if (!req.currentUser) throw new AuthError(401, 'UNAUTHENTICATED', 'Sign in to continue.');
    if (req.currentUser.role !== role) throw new AuthError(403, 'FORBIDDEN', 'This action is not available for your role.');
    next();
  };
  const limited = (limit: number, windowMs: number) => rateLimit({
    limit, windowMs, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, res) => res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } }),
  });
  const credentialsLimiter = limited(options.credentialLimit ?? 10, 15 * 60 * 1000);
  const router = Router();
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.get('/csrf', limited(options.bootstrapLimit ?? 60, 15 * 60 * 1000), async (req, res) => {
    const origin = req.get('Origin');
    if ((origin && !options.origins.includes(origin)) || req.get('Sec-Fetch-Site') === 'cross-site') {
      throw new AuthError(403, 'CSRF_INVALID', 'Request origin is not allowed.');
    }
    if (!req.session.csrfToken) { req.session.csrfToken = token(); await save(req); }
    res.json({ data: { csrfToken: req.session.csrfToken } });
  });
  async function establish(req: Request, user: SafeUser) {
    await regenerate(req);
    req.session.userId = user.id;
    req.session.csrfToken = token();
    req.session.authExpiresAt = Date.now() + AUTH_LIFETIME_MS;
    req.session.cookie.maxAge = AUTH_LIFETIME_MS;
    await save(req);
  }
  router.post('/register', credentialsLimiter, async (req, res) => {
    const input = registerInput.safeParse(req.body);
    if (!input.success) throw new AuthError(400, 'VALIDATION_ERROR', 'Use a valid email, name (1–100 characters), and password (12–128 characters); extra fields are not allowed.');
    const user = await service.register(input.data);
    await establish(req, user);
    res.status(201).json({ data: user });
  });
  router.post('/login', credentialsLimiter, async (req, res) => {
    const input = loginInput.safeParse(req.body);
    if (!input.success) throw new AuthError(400, 'VALIDATION_ERROR', 'Use a valid email and password (12–128 characters); extra fields are not allowed.');
    const user = await service.login(input.data.email, input.data.password);
    await establish(req, user);
    res.json({ data: user });
  });
  router.get('/me', requireAuth, (_req, res) => res.json({ data: _req.currentUser }));
  router.post('/logout', async (req, res) => {
    await destroy(req);
    clearCookie(res);
    res.json({ data: null });
  });
  return {
    middleware: [sessionMiddleware, expire, csrf], router, requireAuth, requireRole,
    trustProxy: options.trustProxy, store,
    async close() { store.close(); await pool.end(); },
  };
}
export type AuthRuntime = Awaited<ReturnType<typeof createAuth>>;
