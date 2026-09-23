import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// Each invocation uses ~128 MiB. Bound concurrent hashing per process.
let activeHashes = 0;
export class PasswordBusyError extends Error {}
async function derive(password: string, salt: string): Promise<Buffer> {
  if (activeHashes >= 2) throw new PasswordBusyError('Password service is busy.');
  activeHashes++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, key) => {
        if (error) reject(error); else resolve(key);
      });
    });
  } finally { activeHashes--; }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$131072$8$1$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  // Reject malformed/unsupported parameters rather than executing arbitrary costs from storage.
  const match = /^scrypt\$131072\$8\$1\$([0-9a-f]{32})\$([0-9a-f]{128})$/.exec(encoded);
  if (!match) return false;
  return timingSafeEqual(await derive(password, match[1]!), Buffer.from(match[2]!, 'hex'));
}
