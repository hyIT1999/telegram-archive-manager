/**
 * Sets a new password for a web user and signs out all of its sessions (forgotten password,
 * or a password that may be known to someone else).
 *   node dist/cli/reset-password.js --email <email> [--password-stdin]
 * Exit codes: 0 done, 1 failure (e.g. no such user), 2 usage error.
 */
import { createPrismaClient } from '@tam/database';
import { loadEnvFiles } from '../config/env-files.js';
import { CLI_ENV_KEYS, cliEnvSchema, formatEnvIssues } from '../config/env.js';
import { PromptCancelledError, readPassword } from './password-input.js';
import {
  parseResetPasswordArgs,
  RESET_PASSWORD_USAGE,
  resetPassword,
  unlockSignIns,
} from './reset-password.command.js';
import { UsageError } from './usage-error.js';

async function main(): Promise<number> {
  const args = parseResetPasswordArgs(process.argv.slice(2));
  if ('help' in args) {
    console.log(RESET_PASSWORD_USAGE);
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
    const outcome = await resetPassword(prisma, { email: args.email, password });
    console.log(
      `Password changed for ${outcome.email}; ${outcome.sessionsEnded} session(s) signed out.`,
    );
  } finally {
    await prisma.$disconnect();
  }

  const redisUrl = env.data.REDIS_URL;
  const unlockError =
    redisUrl === undefined
      ? 'REDIS_URL is not set'
      : await unlockSignIns(redisUrl, env.data.BULLMQ_PREFIX, args.email);
  if (unlockError !== null) {
    console.warn(
      `Could not lift a sign-in lock (${unlockError}); if there is one, it ends by itself within 15 minutes.`,
    );
  }
  return 0;
}

process.exitCode = await main().catch((error: unknown) => {
  if (error instanceof PromptCancelledError) {
    console.error('Cancelled; nothing was changed.');
    return 1;
  }
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${RESET_PASSWORD_USAGE}`);
    return 2;
  }
  console.error(`reset-password failed: ${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
