import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaModule } from '@tam/database/nest';
import { workerConfigOptions } from './config/config-module.js';
import type { WorkerEnv } from './config/env.schema.js';
import { DatabaseStartupCheck } from './database/database-startup-check.js';
import { HeartbeatService } from './heartbeat/heartbeat.service.js';
import { ImportsModule } from './imports/imports.module.js';
import { MediaModule } from './media/media.module.js';
import { bullRootOptions } from './queues/bull-options.js';
import { QueueErrorLogger } from './queues/queue-error-logger.js';
import { QueuesModule } from './queues/queues.module.js';
import { ShutdownCoordinator } from './shutdown/shutdown-coordinator.js';
import { WorkerStatusModule } from './status/worker-status.module.js';
import { TelegramModule } from './telegram/telegram.module.js';

@Module({
  imports: [
    ConfigModule.forRoot(workerConfigOptions()),
    PrismaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) => ({
        url: config.get('DATABASE_URL', { infer: true }),
        applicationName: 'tam-worker',
      }),
    }),
    BullModule.forRootAsync({ inject: [ConfigService], useFactory: bullRootOptions }),
    // Producers for every queue; processors come with the feature modules.
    QueuesModule,
    DiscoveryModule,
    WorkerStatusModule,
    // The single Telegram connection (owner lease, login state machine, RPC server).
    TelegramModule,
    // History imports (telegram-import queue).
    ImportsModule,
    // Media downloads (media-download queue) and thumbnails.
    MediaModule,
  ],
  // HeartbeatService and ShutdownCoordinator must stay here, in the root module: Nest runs
  // onModuleDestroy for the root module first and for global modules (PrismaModule) last.
  providers: [DatabaseStartupCheck, HeartbeatService, ShutdownCoordinator, QueueErrorLogger],
})
export class WorkerModule {}
