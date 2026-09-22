import express, { type ErrorRequestHandler } from 'express';

export function createApp(checkDatabase: () => Promise<void>) {
  const app = express();
  app.disable('x-powered-by');
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
  app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }));
  const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
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
