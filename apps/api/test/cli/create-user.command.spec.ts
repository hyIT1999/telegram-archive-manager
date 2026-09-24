import { Prisma, type PrismaClient } from '@tam/database';
import { describe, expect, it, vi } from 'vitest';
import { verifyPassword } from '../../src/auth/password.js';
import {
  createUser,
  parseCreateUserArgs,
  passwordFromStdin,
  UsageError,
  UserExistsError,
} from '../../src/cli/create-user.command.js';

describe('parseCreateUserArgs', () => {
  it('normalizes the email and reads the flags', () => {
    expect(parseCreateUserArgs(['--email', ' Admin@Example.COM ', '--password-stdin'])).toEqual({
      email: 'admin@example.com',
      ifMissing: false,
    });
    expect(
      parseCreateUserArgs(['--email=admin@example.com', '--password-stdin', '--if-missing']),
    ).toEqual({
      email: 'admin@example.com',
      ifMissing: true,
    });
  });

  it('shows help', () => {
    expect(parseCreateUserArgs(['--help'])).toEqual({ help: true });
    expect(parseCreateUserArgs(['-h'])).toEqual({ help: true });
  });

  it.each([
    [['--email', 'admin@example.com'], /--password-stdin is required/],
    [['--password-stdin'], /--email must be a valid email address/],
    [['--email', 'not-an-email', '--password-stdin'], /--email must be a valid email address/],
    [['--email', 'admin@example.com', '--password-stdin', '--password', 'x'], /Unknown option/],
    [['--email', 'admin@example.com', '--password-stdin', 'extra'], /positional/],
  ])('rejects %j', (argv, message) => {
    expect(() => parseCreateUserArgs(argv)).toThrow(UsageError);
    expect(() => parseCreateUserArgs(argv)).toThrow(message);
  });
});

describe('passwordFromStdin', () => {
  it('removes a BOM and exactly one trailing line ending', () => {
    expect(passwordFromStdin('correct horse battery\n')).toBe('correct horse battery');
    expect(passwordFromStdin(String.fromCharCode(0xfeff) + 'correct horse battery\r\n')).toBe(
      'correct horse battery',
    );
    expect(passwordFromStdin(' spaces are kept  \n\n')).toBe(' spaces are kept  \n');
  });

  it('enforces the password policy', () => {
    expect(() => passwordFromStdin('short\n')).toThrow(UsageError);
    expect(() => passwordFromStdin('short\n')).toThrow('Password must be at least 12 characters');
    expect(() => passwordFromStdin('')).toThrow(UsageError);
  });
});

describe('createUser', () => {
  type CreateArgs = { data: { email: string; passwordHash: string } };

  function fakePrisma(
    existing: { id: string } | null,
    create: (args: CreateArgs) => Promise<{ id: string }> = () =>
      Promise.resolve({ id: 'new-user-id' }),
  ) {
    const user = { findUnique: vi.fn().mockResolvedValue(existing), create: vi.fn(create) };
    return { prisma: { user } as unknown as Pick<PrismaClient, 'user'>, user };
  }

  const input = { email: 'admin@example.com', password: 'correct horse battery', ifMissing: false };

  it('creates the user with an argon2id hash of the password', async () => {
    const { prisma, user } = fakePrisma(null);
    await expect(createUser(prisma, input)).resolves.toEqual({
      status: 'created',
      id: 'new-user-id',
      email: 'admin@example.com',
    });
    const data = user.create.mock.calls[0]?.[0].data ?? { email: '', passwordHash: '' };
    expect(data.email).toBe('admin@example.com');
    expect(data.passwordHash).toMatch(/^\$argon2id\$/);
    await expect(verifyPassword(data.passwordHash, input.password)).resolves.toBe(true);
  });

  it('leaves an existing user alone with --if-missing', async () => {
    const { prisma, user } = fakePrisma({ id: 'existing' });
    await expect(createUser(prisma, { ...input, ifMissing: true })).resolves.toEqual({
      status: 'exists',
      email: 'admin@example.com',
    });
    expect(user.create).not.toHaveBeenCalled();
  });

  it('refuses an existing email without --if-missing', async () => {
    const { prisma } = fakePrisma({ id: 'existing' });
    await expect(createUser(prisma, input)).rejects.toBeInstanceOf(UserExistsError);
  });

  it('treats losing a concurrent-create race like an existing user', async () => {
    const duplicate = () =>
      Promise.reject(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: '7.10.0',
        }),
      );
    await expect(
      createUser(fakePrisma(null, duplicate).prisma, { ...input, ifMissing: true }),
    ).resolves.toMatchObject({
      status: 'exists',
    });
    await expect(createUser(fakePrisma(null, duplicate).prisma, input)).rejects.toBeInstanceOf(
      UserExistsError,
    );
  });
});
