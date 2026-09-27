import { parseArgs } from 'node:util';
import type { PrismaClient } from '@tam/database';
import { emailSchema } from '@tam/shared';
import { Redis } from 'ioredis';
import { loginFailuresKey } from '../auth/login-lockout.js';
import { hashPassword } from '../auth/password.js';
import { UsageError } from './usage-error.js';

export const RESET_PASSWORD_USAGE = `Usage: node apps/api/dist/cli/reset-password.js --email <email> [--password-stdin]

Sets a new password for a web user, signs out all of its sessions and lifts a sign-in lock.
The password is asked twice without showing it, or read from stdin with --password-stdin:
  node apps/api/dist/cli/reset-password.js --email admin@example.com
  echo "<password>" | node apps/api/dist/cli/reset-password.js --email admin@example.com --password-stdin

Options:
  --email <email>    Email address of the user
  --password-stdin   Read the password from stdin (one trailing newline is ignored)
  -h, --help         Show this help`;

export type ResetPasswordArgs = { email: string; passwordStdin: boolean } | { help: true };

export function parseResetPasswordArgs(argv: readonly string[]): ResetPasswordArgs {
  let values: { email?: string; 'password-stdin'?: boolean; help?: boolean };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        email: { type: 'string' },
        'password-stdin': { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error));
  }
  if (values.help) {
    return { help: true };
  }
  const email = emailSchema.safeParse(values.email ?? '');
  if (!email.success) {
    throw new UsageError('--email must be a valid email address');
  }
  return { email: email.data, passwordStdin: values['password-stdin'] ?? false };
}

/** No user has this email. */
export class UserNotFoundError extends Error {
  override readonly name = 'UserNotFoundError';

  constructor(readonly email: string) {
    super(`No user has the email ${email}`);
  }
}

export interface ResetPasswordOutcome {
  id: string;
  email: string;
  /** Sessions signed out (every browser has to sign in again). */
  sessionsEnded: number;
}

/** Replaces the password hash and ends every session of the user, in one transaction. */
export async function resetPassword(
  prisma: Pick<PrismaClient, 'user' | 'session' | '$transaction'>,
  input: { email: string; password: string },
): Promise<ResetPasswordOutcome> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (!user) {
    throw new UserNotFoundError(input.email);
  }
  const passwordHash = await hashPassword(input.password);
  const [, ended] = await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);
  return { id: user.id, email: input.email, sessionsEnded: ended.count };
}

/** Forgets the email's failed sign-ins in Redis. Resolves to an error message, or null. */
export async function unlockSignIns(
  redisUrl: string,
  prefix: string,
  email: string,
): Promise<string | null> {
  const redis = new Redis(redisUrl, {
    connectionName: 'tam-cli',
    lazyConnect: true,
    connectTimeout: 5_000,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });
  redis.on('error', () => {
    // Reported by the failing command below.
  });
  try {
    await redis.connect();
    await redis.del(loginFailuresKey(prefix, email));
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    redis.disconnect();
  }
}
