import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ALL_QUEUES } from '@tam/shared';

/**
 * One producer (`Queue`) per queue for the whole worker: feature modules inject them with
 * `@InjectQueue(name)` instead of registering duplicates of their own.
 */
@Global()
@Module({
  imports: [BullModule.registerQueue(...ALL_QUEUES.map((name) => ({ name })))],
  exports: [BullModule],
})
export class QueuesModule {}
