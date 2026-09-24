import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DiscoveryModule } from '@nestjs/core';
import { PrismaModule } from '@tam/database/nest';
import { ALL_QUEUES } from '@tam/shared';
import { validateWorkerEnv, type WorkerEnv } from './config/env.schema.js';
import { DatabaseStartupCheck } from './database/database-startup-check.js';
import { HeartbeatService } from './heartbeat/heartbeat.service.js';
import { bullRootOptions } from './queues/bull-options.js';
import { QueueErrorLogger } from './queues/queue-error-logger.js';
import { ShutdownCoordinator } from './shutdown/shutdown-coordinator.js';

@Module({
  imports: [
    // main.ts loads the .env files before this module is evaluated; tests set process.env.
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      ignoreEnvFile: true,
      validate: validateWorkerEnv,
    }),
    PrismaModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<WorkerEnv, true>) => ({
        url: config.get('DATABASE_URL', { infer: true }),
        applicationName: 'tam-worker',
      }),
    }),
    BullModule.forRootAsync({ inject: [ConfigService], useFactory: bullRootOptions }),
    // Producers for every queue. Processors arrive with the feature modules of Phases 2–4.
    BullModule.registerQueue(...ALL_QUEUES.map((name) => ({ name }))),
    DiscoveryModule,
  ],
  // HeartbeatService and ShutdownCoordinator must stay here, in the root module: Nest runs
  // onModuleDestroy for the root module first and for global modules (PrismaModule) last.
  providers: [DatabaseStartupCheck, HeartbeatService, ShutdownCoordinator, QueueErrorLogger],
})
export class WorkerModule {}
