import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import type { Env, LogLevelName } from '../config/env.js';

const NEST_LOG_LEVELS: Record<LogLevelName, readonly LogLevel[]> = {
  debug: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
  info: ['fatal', 'error', 'warn', 'log'],
  warn: ['fatal', 'error', 'warn'],
  error: ['fatal', 'error'],
};

/** Maps LOG_LEVEL to the Nest levels it enables (each level includes the more severe ones). */
export function nestLogLevels(level: LogLevelName): LogLevel[] {
  return [...NEST_LOG_LEVELS[level]];
}

/** JSON lines in production (for log shippers), human-readable text elsewhere. */
export function createAppLogger(env: Pick<Env, 'NODE_ENV' | 'LOG_LEVEL'>): ConsoleLogger {
  const json = env.NODE_ENV === 'production';
  return new ConsoleLogger({
    json,
    logLevels: nestLogLevels(env.LOG_LEVEL),
    colors: !json && Boolean(process.stdout.isTTY),
  });
}
