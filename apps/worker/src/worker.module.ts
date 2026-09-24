import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaModule } from '@tam/database/nest';
import { ALL_QUEUES } from '@tam/shared';
import { workerConfigOptions } from './config/config-module.js';
import type { WorkerEnv } from './config/env.schema.js';
import { DatabaseStartupCheck } from './database/database-startup-check.js';
import { HeartbeatService } from './heartbeat/heartbeat.service.js';
import { bullRootOptions } from './queues/bull-options.js';
import { QueueErrorLogger } from './queues/queue-error-logger.js';
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
    // Producers for every queue. Processors arrive with the feature modules of Phases 3–4.
    BullModule.registerQueue(...ALL_QUEUES.map((name) => ({ name }))),
    DiscoveryModule,
    WorkerStatusModule,
    // The single Telegram connection (owner lease, login state machine, RPC server).
    TelegramModule,
  ],
  // HeartbeatService and ShutdownCoordinator must stay here, in the root module: Nest runs
  // onModuleDestroy for the root module first and for global modules (PrismaModule) last.
  providers: [DatabaseStartupCheck, HeartbeatService, ShutdownCoordinator, QueueErrorLogger],
})
export class WorkerModule {}
