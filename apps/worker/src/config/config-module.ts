import type { ConfigModuleOptions } from '@nestjs/config';
import { validateWorkerEnv } from './env.schema.js';

/**
 * main.ts loads the .env files into process.env before the module is evaluated (tests set
 * process.env). The validated values are the only source afterwards (`skipProcessEnv`): a blank
 * `KEY=` stays unset instead of reappearing as "" from process.env.
 */
export function workerConfigOptions(): ConfigModuleOptions {
  return {
    isGlobal: true,
    cache: true,
    ignoreEnvFile: true,
    validate: validateWorkerEnv,
    skipProcessEnv: true,
  };
}
