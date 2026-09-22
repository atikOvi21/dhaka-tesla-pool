import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { env } from './config.js';

export const db = new PrismaClient({ adapter: new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: 5, connectionTimeoutMillis: 2000, query_timeout: 2000, statement_timeout: 2000,
}) });
