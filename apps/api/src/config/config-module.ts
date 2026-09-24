import type { ConfigModuleOptions } from '@nestjs/config';
import { envFileParser, envFilePaths } from './env-files.js';
import { ENV_KEYS, validateEnv } from './env.js';

/**
 * Validates process.env + the root .env once at startup; an invalid environment aborts the boot.
 * The validated values are the only source afterwards (`validate` + `skipProcessEnv`): a blank
 * `KEY=` stays unset instead of reappearing as "".
 */
export function configModuleOptions(): ConfigModuleOptions {
  return {
    isGlobal: true,
    cache: true,
    envFilePath: envFilePaths(),
    parser: envFileParser(ENV_KEYS),
    validate: validateEnv,
    skipProcessEnv: true,
  };
}
