import { describe, expect, it } from 'vitest';
import { loginFailuresKey } from '../../src/auth/login-lockout.js';
import { parseResetPasswordArgs } from '../../src/cli/reset-password.command.js';
import { UsageError } from '../../src/cli/usage-error.js';

describe('parseResetPasswordArgs', () => {
  it('normalizes the email and reads --password-stdin', () => {
    expect(parseResetPasswordArgs(['--email', ' Admin@Example.COM '])).toEqual({
      email: 'admin@example.com',
      passwordStdin: false,
    });
    expect(parseResetPasswordArgs(['--email=admin@example.com', '--password-stdin'])).toEqual({
      email: 'admin@example.com',
      passwordStdin: true,
    });
    expect(parseResetPasswordArgs(['-h'])).toEqual({ help: true });
  });

  it.each([
    [[], /--email must be a valid email address/],
    [['--email', 'nope'], /--email must be a valid email address/],
    [['--email', 'admin@example.com', '--password', 'x'], /Unknown option/],
    [['--email', 'admin@example.com', 'extra'], /positional/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseResetPasswordArgs(argv)).toThrow(UsageError);
    expect(() => parseResetPasswordArgs(argv)).toThrow(message);
  });
});

describe('loginFailuresKey', () => {
  it('hashes the email under the prefix, never storing the address', () => {
    const key = loginFailuresKey('tam', 'admin@example.com');
    expect(key).toMatch(/^tam:auth:login-failures:[0-9a-f]{64}$/);
    expect(key).not.toContain('admin');
    expect(loginFailuresKey('tam', 'admin@example.com')).toBe(key);
    expect(loginFailuresKey('other', 'admin@example.com')).not.toBe(key);
  });
});
