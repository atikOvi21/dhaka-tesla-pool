import { config } from 'dotenv';
import { z } from 'zod';

config({ path: '../../.env', quiet: true });
export const env = z.object({
  DATABASE_URL: z.string().url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
}).parse(process.env);
