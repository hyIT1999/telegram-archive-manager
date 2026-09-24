import { ConsoleLogger, type LogLevel } from '@nestjs/common';
import type { LogLevelName, WorkerEnv } from './env.schema.js';

const NEST_LOG_LEVELS: Record<LogLevelName, readonly LogLevel[]> = {
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

/** Nest log levels enabled by a LOG_LEVEL value. */
export function nestLogLevels(level: LogLevelName): LogLevel[] {
  return [...NEST_LOG_LEVELS[level]];
}

/** One JSON object per line in production (for log shippers), readable text otherwise. */
export function createWorkerLogger(env: Pick<WorkerEnv, 'NODE_ENV' | 'LOG_LEVEL'>): ConsoleLogger {
  const logLevels = nestLogLevels(env.LOG_LEVEL);
  return env.NODE_ENV === 'production'
    ? new ConsoleLogger({ json: true, logLevels })
    : new ConsoleLogger({ prefix: 'Worker', logLevels });
}
