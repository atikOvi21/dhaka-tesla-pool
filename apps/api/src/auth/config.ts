import { z } from 'zod';

export function loadAuthConfig(source: NodeJS.ProcessEnv) {
  const parsed = z.object({
    SESSION_SECRET: z.string().min(32).refine(value => !value.startsWith('replace-')),
    AUTH_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),
    SESSION_COOKIE_SECURE: z.enum(['true', 'false']).optional(),
    TRUST_PROXY_HOPS: z.enum(['0', '1']).default('0'),
  }).safeParse(source);
  if (!parsed.success) throw new Error('Invalid auth configuration: set a random SESSION_SECRET (32+ characters) and valid cookie/proxy settings.');
  const values = parsed.data;
  const origins = values.AUTH_ORIGINS.split(',').map(value => value.trim());
  const secureCookie = values.SESSION_COOKIE_SECURE === undefined ? source.NODE_ENV === 'production' : values.SESSION_COOKIE_SECURE === 'true';
  for (const origin of origins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol)) throw new Error('AUTH_ORIGINS must contain exact HTTP(S) origins.');
    if (secureCookie && url.protocol !== 'https:') throw new Error('Secure cookies require HTTPS origins.');
    if (!secureCookie && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('Insecure cookies are allowed only for local loopback origins.');
  }
  return { secret: values.SESSION_SECRET, origins, secureCookie, trustProxy: Number(values.TRUST_PROXY_HOPS) as 0 | 1 };
}
