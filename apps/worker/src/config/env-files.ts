import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

/**
 * The .env files read at startup, most specific first: the working directory, then the
 * repository root (npm -w runs the worker's scripts from apps/worker).
 */
export function defaultEnvFiles(cwd: string = process.cwd()): string[] {
  return [path.resolve(cwd, '.env'), path.resolve(cwd, '../../.env')];
}

/**
 * Copies variables from `files` into `target` without overwriting anything: variables that are
 * already set (the real environment) win, and earlier files win over later ones. Missing files
 * are skipped. Returns the files that were read.
 */
export function loadEnvFiles(
  files: readonly string[],
  target: Record<string, string | undefined> = process.env,
): string[] {
  const loaded: string[] = [];
  for (const file of files) {
    if (!existsSync(file)) {
      continue;
    }
    for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
      if (target[key] === undefined && value !== undefined) {
        target[key] = value;
      }
    }
    loaded.push(file);
  }
  return loaded;
}
