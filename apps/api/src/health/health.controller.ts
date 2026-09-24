import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { HealthLiveDto, HealthReadyDto } from '@tam/shared';
import type { Response } from 'express';
import { Public } from '../auth/public.decorator.js';
import { HealthService } from './health.service.js';

/** Probes for pm2/Docker/load balancers: no session, no rate limit, never cached (global default). */
@Public()
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** The process is up and serving HTTP. */
  @Get('live')
  live(): HealthLiveDto {
    return { status: 'ok' };
  }

  /** 200 when PostgreSQL and Redis answer, 503 otherwise (same body either way). */
  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<HealthReadyDto> {
    const report = await this.health.readiness();
    if (report.status !== 'ok') {
      response.status(HttpStatus.SERVICE_UNAVAILABLE);
    }
    return report;
  }
}
