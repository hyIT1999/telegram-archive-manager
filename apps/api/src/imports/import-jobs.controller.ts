import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  type IdParam,
  type ImportJobDto,
  type ImportJobListQuery,
  type ImportRequest,
  type Page,
  idParamSchema,
  importJobListQuerySchema,
  importRequestSchema,
} from '@tam/shared';
import type { Response } from 'express';
import { ImportJobsService } from './import-jobs.service.js';

@Controller()
export class ImportJobsController {
  constructor(private readonly imports: ImportJobsService) {}

  /**
   * Starts importing the channel's history: 202 with the new job, or 200 with the unfinished job
   * when the same import was already started (idempotent).
   */
  @Post('channels/:id/import')
  async start(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: importRequestSchema }) request: ImportRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ImportJobDto> {
    const { job, created } = await this.imports.start(params.id, request);
    response.status(created ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return job;
  }

  /** Newest first; filter by `channelId` and `status` (comma separated). */
  @Get('import-jobs')
  list(
    @Query({ schema: importJobListQuerySchema }) query: ImportJobListQuery,
  ): Promise<Page<ImportJobDto>> {
    return this.imports.list(query);
  }

  @Get('import-jobs/:id')
  get(@Param({ schema: idParamSchema }) params: IdParam): Promise<ImportJobDto> {
    return this.imports.get(params.id);
  }

  @Post('import-jobs/:id/pause')
  @HttpCode(HttpStatus.OK)
  pause(@Param({ schema: idParamSchema }) params: IdParam): Promise<ImportJobDto> {
    return this.imports.pause(params.id);
  }

  @Post('import-jobs/:id/resume')
  @HttpCode(HttpStatus.ACCEPTED)
  resume(@Param({ schema: idParamSchema }) params: IdParam): Promise<ImportJobDto> {
    return this.imports.resume(params.id);
  }

  @Post('import-jobs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param({ schema: idParamSchema }) params: IdParam): Promise<ImportJobDto> {
    return this.imports.cancel(params.id);
  }
}
