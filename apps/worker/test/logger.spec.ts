import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkerLogger, nestLogLevels } from '../src/config/logger.js';

describe('nestLogLevels', () => {
  it.each([
    ['error', ['fatal', 'error']],
    ['warn', ['fatal', 'error', 'warn']],
    ['info', ['fatal', 'error', 'warn', 'log']],
    ['debug', ['fatal', 'error', 'warn', 'log', 'debug', 'verbose']],
  ] as const)('LOG_LEVEL=%s enables %j', (level, expected) => {
    expect(nestLogLevels(level)).toEqual(expected);
  });
});

describe('createWorkerLogger', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureStdout(): string[] {
    const lines: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      lines.push(String(chunk));
      return true;
    });
    return lines;
  }

  it('writes one JSON object per line in production', () => {
    const lines = captureStdout();
    createWorkerLogger({ NODE_ENV: 'production', LOG_LEVEL: 'info' }).log('ready', 'Bootstrap');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? '')).toMatchObject({
      level: 'log',
      message: 'ready',
      context: 'Bootstrap',
    });
  });

  it('writes text elsewhere and drops levels below LOG_LEVEL', () => {
    const lines = captureStdout();
    const logger = createWorkerLogger({ NODE_ENV: 'development', LOG_LEVEL: 'info' });
    logger.debug('hidden', 'Bootstrap');
    logger.log('shown', 'Bootstrap');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('[Worker]');
    expect(lines[0]).toContain('shown');
  });
});
