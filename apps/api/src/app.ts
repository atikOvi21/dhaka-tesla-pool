import express, { type ErrorRequestHandler } from 'express';
import type { AuthRuntime } from './auth/index.js';
import { AuthError } from './auth/service.js';
import { PasswordBusyError } from './password.js';

export function createApp(checkDatabase: () => Promise<void>, auth?: AuthRuntime) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', auth?.trustProxy ?? false);
  app.use(express.json({ limit: '16kb' }));
  app.get('/api/v1/health/live', (_req, res) => res.json({ data: { status: 'ok' } }));
  app.get('/api/v1/health/ready', async (_req, res) => {
    try {
      await checkDatabase();
      res.json({ data: { status: 'ready' } });
    } catch {
      res.status(503).json({ error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is not ready.' } });
    }
  });
  if (auth) {
    // Future business routers must mount AFTER this session/CSRF boundary.
    app.use('/api/v1', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); }, ...auth.middleware);
    app.use('/api/v1/auth', auth.router);
  }
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    if (error instanceof AuthError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof PasswordBusyError) {
      res.set('Retry-After', '2').status(503).json({ error: { code: 'AUTH_BUSY', message: 'Please retry shortly.' } });
      return;
    }
    const status = typeof error === 'object' && error !== null && 'status' in error ? error.status : undefined;
    if (status === 400 || status === 413) {
      res.status(status).json({ error: { code: 'VALIDATION_ERROR', message: status === 413 ? 'Request body too large.' : 'Invalid JSON body.' } });
      return;
    }
    console.error(JSON.stringify({ event: 'request_failed' }));
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  };
  app.use(errorHandler);
  return app;
}
