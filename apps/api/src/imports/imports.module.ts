import { Module } from '@nestjs/common';
import { ImportJobsController } from './import-jobs.controller.js';
import { ImportJobsService } from './import-jobs.service.js';
import { ImportQueue } from './import-queue.js';

@Module({
  controllers: [ImportJobsController],
  providers: [ImportJobsService, ImportQueue],
  // Live updates send jobs as the import-jobs endpoints return them.
  exports: [ImportJobsService],
})
export class ImportsModule {}
