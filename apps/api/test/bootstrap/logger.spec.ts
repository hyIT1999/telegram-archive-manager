import { describe, expect, it } from 'vitest';
import { nestLogLevels } from '../../src/bootstrap/logger.js';

describe('nestLogLevels', () => {
  it('enables the chosen level and everything more severe', () => {
    expect(nestLogLevels('error')).toEqual(['fatal', 'error']);
    expect(nestLogLevels('warn')).toEqual(['fatal', 'error', 'warn']);
    expect(nestLogLevels('info')).toEqual(['fatal', 'error', 'warn', 'log']);
    expect(nestLogLevels('debug')).toEqual(['fatal', 'error', 'warn', 'log', 'debug', 'verbose']);
  });

  it('returns a copy callers may modify', () => {
    nestLogLevels('info').push('debug');
    expect(nestLogLevels('info')).not.toContain('debug');
  });
});
