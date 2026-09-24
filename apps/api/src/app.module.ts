import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { PrismaModule } from '@tam/database/nest';
import { AuthModule } from './auth/auth.module.js';
import { SessionGuard } from './auth/session.guard.js';
import { ChannelsModule } from './channels/channels.module.js';
import { createValidationPipe } from './common/validation/validation.pipe.js';
import { configModuleOptions } from './config/config-module.js';
import type { Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { ImportsModule } from './imports/imports.module.js';
import { RedisModule } from './redis/redis.module.js';
import { StatsModule } from './stats/stats.module.js';
import { StorageModule } from './storage/storage.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

/** Requests per client IP and minute on every route (login is much stricter). */
const DEFAULT_THROTTLE = { name: 'default', limit: 300, ttl: 60_000 };

@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions()),
    PrismaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        url: config.get('DATABASE_URL', { infer: true }),
        applicationName: 'tam-api',
      }),
    }),
    RedisModule,
    ThrottlerModule.forRoot({
      throttlers: [DEFAULT_THROTTLE],
      errorMessage: 'Too many requests, please try again later',
    }),
    AuthModule,
    HealthModule,
    ChannelsModule,
    ImportsModule,
    StatsModule,
    StorageModule,
    TelegramModule,
  ],
  providers: [
    // Global guards run in this order: rate limiting first, then authentication.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
