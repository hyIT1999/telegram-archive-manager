import { Global, Module } from '@nestjs/common';
import { WorkerStatusService } from './worker-status.service.js';

@Global()
@Module({
  providers: [WorkerStatusService],
  exports: [WorkerStatusService],
})
export class WorkerStatusModule {}
