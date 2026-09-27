import { parseArgs } from 'node:util';
import { Prisma, type PrismaClient } from '@tam/database';
import { emailSchema } from '@tam/shared';
import { hashPassword } from '../auth/password.js';
import { UsageError } from './usage-error.js';

export const CREATE_USER_USAGE = `Usage: node apps/api/dist/cli/create-user.js --email <email> [--password-stdin] [--if-missing]

Creates a web user. The password is never taken from the command line: the command asks for it
twice without showing it, or reads it from stdin with --password-stdin (scripts, Docker):
  node apps/api/dist/cli/create-user.js --email admin@example.com
  echo "<password>" | node apps/api/dist/cli/create-user.js --email admin@example.com --password-stdin

Options:
  --email <email>    Email address (stored trimmed and lower-cased)
  --password-stdin   Read the password from stdin (one trailing newline is ignored)
  --if-missing       Exit successfully without changes when the email already exists
  -h, --help         Show this help`;

/** The email is taken and --if-missing was not given. */
export class UserExistsError extends Error {
  override readonly name = 'UserExistsError';

  constructor(readonly email: string) {
    super(`A user with email ${email} already exists (use --if-missing to accept that)`);
  }
}

export interface CreateUserOptions {
  email: string;
  ifMissing: boolean;
}

export type CreateUserArgs = (CreateUserOptions & { passwordStdin: boolean }) | { help: true };

export function parseCreateUserArgs(argv: readonly string[]): CreateUserArgs {
  let values: {
    email?: string;
    'password-stdin'?: boolean;
    'if-missing'?: boolean;
    help?: boolean;
  };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        email: { type: 'string' },
        'password-stdin': { type: 'boolean' },
        'if-missing': { type: 'boolean' },
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
  return {
    email: email.data,
    ifMissing: values['if-missing'] ?? false,
    passwordStdin: values['password-stdin'] ?? false,
  };
}

export type CreateUserOutcome =
  { status: 'created'; id: string; email: string } | { status: 'exists'; email: string };

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** Creates the user, or reports an existing one (an error unless ifMissing). */
export async function createUser(
  prisma: Pick<PrismaClient, 'user'>,
  input: CreateUserOptions & { password: string },
): Promise<CreateUserOutcome> {
  const existing = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (existing) {
    if (input.ifMissing) {
      return { status: 'exists', email: input.email };
    }
    throw new UserExistsError(input.email);
  }
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: { email: input.email, passwordHash },
      select: { id: true },
    });
    return { status: 'created', id: user.id, email: input.email };
  } catch (error) {
    // Lost a race with a concurrent create of the same email.
    if (isUniqueViolation(error)) {
      if (input.ifMissing) {
        return { status: 'exists', email: input.email };
      }
      throw new UserExistsError(input.email);
    }
    throw error;
  }
}
