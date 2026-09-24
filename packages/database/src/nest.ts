import {
  type DynamicModule,
  Global,
  Inject,
  Injectable,
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export const PRISMA_OPTIONS = Symbol('PRISMA_OPTIONS');

export interface PrismaModuleOptions {
  url: string;
  poolMax?: number;
  applicationName?: string;
}

/** Nest-managed Prisma client; connects on module init and disconnects on shutdown. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(PRISMA_OPTIONS) options: PrismaModuleOptions) {
    super({
      adapter: new PrismaPg({
        connectionString: options.url,
        max: options.poolMax ?? 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 300_000,
        application_name: options.applicationName,
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

export interface PrismaModuleAsyncOptions {
  imports?: DynamicModule['imports'];
  inject?: Array<string | symbol | (abstract new (...args: never[]) => unknown)>;
  useFactory: (...args: never[]) => PrismaModuleOptions | Promise<PrismaModuleOptions>;
}

@Global()
@Module({})
export class PrismaModule {
  static forRootAsync(options: PrismaModuleAsyncOptions): DynamicModule {
    return {
      module: PrismaModule,
      imports: options.imports ?? [],
      providers: [
        { provide: PRISMA_OPTIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        PrismaService,
      ],
      exports: [PrismaService],
    };
  }
}
