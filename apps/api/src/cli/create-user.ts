/**
 * Creates a web user; the password is asked on the terminal or read from stdin (Docker, scripts).
 *   node dist/cli/create-user.js --email <email> [--password-stdin] [--if-missing]
 * Exit codes: 0 created or already present with --if-missing, 1 failure, 2 usage error.
 */
import { createPrismaClient } from '@tam/database';
import { loadEnvFiles } from '../config/env-files.js';
import { CLI_ENV_KEYS, cliEnvSchema, formatEnvIssues } from '../config/env.js';
import { CREATE_USER_USAGE, createUser, parseCreateUserArgs } from './create-user.command.js';
import { PromptCancelledError, readPassword } from './password-input.js';
import { UsageError } from './usage-error.js';

async function main(): Promise<number> {
  const args = parseCreateUserArgs(process.argv.slice(2));
  if ('help' in args) {
    console.log(CREATE_USER_USAGE);
    return 0;
  }
  const password = await readPassword(args.passwordStdin);

  loadEnvFiles(CLI_ENV_KEYS);
  const env = cliEnvSchema.safeParse(process.env);
  if (!env.success) {
    console.error(`Invalid environment:\n${formatEnvIssues(env.error)}`);
    return 1;
  }

  const prisma = createPrismaClient({
    url: env.data.DATABASE_URL,
    max: 1,
    applicationName: 'tam-cli',
  });
  try {
    const outcome = await createUser(prisma, { ...args, password });
    console.log(
      outcome.status === 'created'
        ? `Created user ${outcome.email} (${outcome.id}).`
        : `User ${outcome.email} already exists; nothing to do.`,
    );
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  if (error instanceof PromptCancelledError) {
    console.error('Cancelled; nothing was changed.');
    return 1;
  }
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${CREATE_USER_USAGE}`);
    return 2;
  }
  console.error(`create-user failed: ${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
