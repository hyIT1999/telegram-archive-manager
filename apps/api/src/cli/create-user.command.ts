import { parseArgs } from 'node:util';
import { Prisma, type PrismaClient } from '@tam/database';
import { emailSchema, newPasswordSchema } from '@tam/shared';
import { hashPassword } from '../auth/password.js';

export const CREATE_USER_USAGE = `Usage: node dist/cli/create-user.js --email <email> --password-stdin [--if-missing]

Creates a web user. The password is read from stdin, never from the command line:
  echo "<password>" | npm run user:create -- --email admin@example.com --password-stdin

Options:
  --email <email>    Email address (stored trimmed and lower-cased)
  --password-stdin   Read the password from stdin (required; one trailing newline is ignored)
  --if-missing       Exit successfully without changes when the email already exists
  -h, --help         Show this help`;

/** Bad invocation or input; the CLI prints the message (and usage) and exits with code 2. */
export class UsageError extends Error {
  override readonly name = 'UsageError';
}

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

export type CreateUserArgs = CreateUserOptions | { help: true };

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
  if (!values['password-stdin']) {
    throw new UsageError('--password-stdin is required: pipe the password into the command');
  }
  const email = emailSchema.safeParse(values.email ?? '');
  if (!email.success) {
    throw new UsageError('--email must be a valid email address');
  }
  return { email: email.data, ifMissing: values['if-missing'] ?? false };
}

const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** Strips a UTF-8 BOM and the single line ending that `echo` or a pipe appends. */
export function passwordFromStdin(raw: string): string {
  const withoutBom = raw.startsWith(BYTE_ORDER_MARK) ? raw.slice(1) : raw;
  const password = withoutBom.replace(/\r?\n$/, '');
  const checked = newPasswordSchema.safeParse(password);
  if (!checked.success) {
    throw new UsageError(checked.error.issues.map((issue) => issue.message).join('; '));
  }
  return checked.data;
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
