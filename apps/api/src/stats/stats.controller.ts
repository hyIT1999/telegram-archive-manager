import { Controller, Get } from '@nestjs/common';
import type { StatsDto } from '@tam/shared';
import { StatsService } from './stats.service.js';

@Controller('stats')
export class StatsController {
  constructor(private readonly stats: StatsService) {}

  @Get()
  totals(): Promise<StatsDto> {
    return this.stats.totals();
  }
}
