import { randomBytes, scrypt } from 'node:crypto';

// Parameters are embedded so authentication can verify/upgrade hashes later.
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }, (error, derived) => {
      if (error) reject(error); else resolve(derived);
    });
  });
  return `scrypt$131072$8$1$${salt}$${key.toString('hex')}`;
}
