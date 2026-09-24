import { Injectable, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '@tam/database/nest';
import { errorMessage } from '../common/error-message.js';

/**
 * Fails startup when PostgreSQL is unreachable. With the pg driver adapter, PrismaService's
 * $connect() opens no connection, so without this ping the worker would report itself ready
 * and start its heartbeat while every job would fail. Runs in onModuleInit, i.e. before the
 * first heartbeat is written in onApplicationBootstrap.
 */
@Injectable()
export class DatabaseStartupCheck implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      // Prisma puts a multi-line invocation banner before the cause; keep the cause line.
      const cause = errorMessage(error).trim().split('\n').at(-1);
      throw new Error(`Database unreachable: ${cause}`, { cause: error });
    }
  }
}
