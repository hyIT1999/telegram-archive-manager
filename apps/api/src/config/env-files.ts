import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getDefaultParser, type Parser } from '@nestjs/config';

/**
 * The monorepo keeps a single .env at the repository root. Apps run either from the root
 * (`node apps/api/dist/main.js`) or from their own folder (`npm run start -w @tam/api`).
 * Earlier files win over later ones, and real environment variables win over both.
 */
export function envFilePaths(cwd: string = process.cwd()): string[] {
  return [path.resolve(cwd, '.env'), path.resolve(cwd, '../../.env')];
}

/**
 * Parses env files the way @nestjs/config does but keeps only `keys`: the shared .env also holds
 * other processes' secrets (the worker's Telegram credentials), which stay out of this process.
 */
export function envFileParser(keys: readonly string[]): Parser {
  const parse = getDefaultParser();
  const wanted = new Set(keys);
  return (buffer) =>
    Object.fromEntries(Object.entries(parse(buffer)).filter(([key]) => wanted.has(key)));
}

/** Loads `keys` from the env files into process.env without overriding variables already set. */
export function loadEnvFiles(
  keys: readonly string[],
  paths: readonly string[] = envFilePaths(),
): void {
  const parse = envFileParser(keys);
  for (const file of paths) {
    if (!existsSync(file)) {
      continue;
    }
    for (const [key, value] of Object.entries(parse(readFileSync(file)))) {
      if (process.env[key] === undefined && typeof value === 'string') {
        process.env[key] = value;
      }
    }
  }
}
