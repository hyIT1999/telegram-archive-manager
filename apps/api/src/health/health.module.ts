import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

@Module({
  // Only HealthIndicatorService is used; HealthCheckService's 503 body is not the HealthReadyDto contract.
  imports: [TerminusModule.forRoot({ logger: false })],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
