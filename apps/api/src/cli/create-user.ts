/**
 * Creates a web user (non-interactive; also used by the Docker `bootstrap` service).
 *   echo "<password>" | node dist/cli/create-user.js --email <email> --password-stdin [--if-missing]
 * Exit codes: 0 created or already present with --if-missing, 1 failure, 2 usage error.
 */
import { createPrismaClient } from '@tam/database';
import { loadEnvFiles } from '../config/env-files.js';
import { CLI_ENV_KEYS, cliEnvSchema, formatEnvIssues } from '../config/env.js';
import {
  CREATE_USER_USAGE,
  createUser,
  parseCreateUserArgs,
  passwordFromStdin,
  UsageError,
} from './create-user.command.js';

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main(): Promise<number> {
  const args = parseCreateUserArgs(process.argv.slice(2));
  if ('help' in args) {
    console.log(CREATE_USER_USAGE);
    return 0;
  }
  if (process.stdin.isTTY) {
    throw new UsageError('No password on stdin: pipe it into the command (see the example below)');
  }
  const password = passwordFromStdin(await readStdin());

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
  if (error instanceof UsageError) {
    console.error(`${error.message}\n\n${CREATE_USER_USAGE}`);
    return 2;
  }
  console.error(`create-user failed: ${error instanceof Error ? error.message : String(error)}`);
  return 1;
});
