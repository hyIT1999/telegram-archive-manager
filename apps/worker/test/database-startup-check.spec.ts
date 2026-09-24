import type { PrismaService } from '@tam/database/nest';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseStartupCheck } from '../src/database/database-startup-check.js';

function checkWith(queryRaw: () => Promise<unknown>): DatabaseStartupCheck {
  return new DatabaseStartupCheck({ $queryRaw: vi.fn(queryRaw) } as unknown as PrismaService);
}

describe('DatabaseStartupCheck', () => {
  it('lets startup continue when the database answers', async () => {
    await expect(
      checkWith(() => Promise.resolve([{ '?column?': 1 }])).onModuleInit(),
    ).resolves.toBe(undefined);
  });

  it('fails startup with the cause line of the Prisma error', async () => {
    const prismaError = new Error(
      '\nInvalid `prisma.$queryRaw()` invocation:\n\n\n' +
        "Raw query failed. Code: `N/A`. Message: `Can't reach database server at 127.0.0.1:5439`",
    );
    const failure = checkWith(() => Promise.reject(prismaError)).onModuleInit();

    await expect(failure).rejects.toThrow(
      "Database unreachable: Raw query failed. Code: `N/A`. Message: `Can't reach database server at 127.0.0.1:5439`",
    );
    await expect(failure).rejects.toMatchObject({ cause: prismaError });
  });
});
