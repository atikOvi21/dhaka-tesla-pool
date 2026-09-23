import { randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { hashPassword, verifyPassword } from '../password.js';

export class AuthError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export const safeUserSelect = { id: true, name: true, email: true, role: true } as const;
export type SafeUser = Prisma.UserGetPayload<{ select: typeof safeUserSelect }>;

export async function createAuthService(db: PrismaClient) {
  // A missing account still pays the same scrypt cost as a wrong password.
  const dummyHash = await hashPassword(randomBytes(32).toString('hex'));
  return {
    async register(input: { name: string; email: string; password: string }): Promise<SafeUser> {
      const password_hash = await hashPassword(input.password);
      try {
        return await db.user.create({ data: { name: input.name, email: input.email, password_hash, role: 'PASSENGER' }, select: safeUserSelect });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new AuthError(409, 'EMAIL_UNAVAILABLE', 'An account with this email already exists.');
        }
        throw error;
      }
    },
    async login(email: string, password: string): Promise<SafeUser> {
      const user = await db.user.findUnique({ where: { email } });
      const valid = await verifyPassword(password, user?.password_hash ?? dummyHash);
      if (!user || !valid) throw new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
      return { id: user.id, name: user.name, email: user.email, role: user.role };
    },
    findUser(id: string) { return db.user.findUnique({ where: { id }, select: safeUserSelect }); },
  };
}
