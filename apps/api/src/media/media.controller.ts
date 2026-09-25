import { readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiErrorCode, type IdParam, type MediaDto, idParamSchema } from '@tam/shared';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { withStorageErrors } from '../storage/storage-errors.js';
import { parseByteRange } from './byte-range.js';
import { contentDisposition, isInlineType } from './content-disposition.js';
import { MediaService } from './media.service.js';

/** `?download=1` asks for a download even for files browsers can show. */
const contentQuerySchema = z.object({
  download: z
    .enum(['0', '1', 'false', 'true'])
    .transform((value) => value === '1' || value === 'true')
    .optional(),
});
type ContentQuery = z.infer<typeof contentQuerySchema>;

/**
 * Media files of the archive. Players and image grids send many (range) requests, so these
 * routes are not rate limited; they still need a session like every other route.
 */
@SkipThrottle()
@Controller('media')
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get(':id')
  get(@Param({ schema: idParamSchema }) params: IdParam): Promise<MediaDto> {
    return this.media.get(params.id);
  }

  /**
   * The stored file, whole (200) or a byte range of it (206, 416 outside the file). Only images,
   * browser video/audio and PDF are shown inline; anything else downloads, and nothing is ever
   * sniffed into another type.
   */
  @Get(':id/content')
  async content(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Query({ schema: contentQuerySchema }) query: ContentQuery,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const content = await this.media.openContent(params.id);
    const info = await withStorageErrors(() => content.driver.stat(content.key));
    if (!info) {
      throw new NotFoundException({
        code: ApiErrorCode.NOT_FOUND,
        message: 'The stored file is missing from its storage location.',
      });
    }
    const inline = query.download !== true && isInlineType(content.mimeType);
    response.setHeader('Content-Type', content.mimeType);
    response.setHeader(
      'Content-Disposition',
      contentDisposition(inline ? 'inline' : 'attachment', content.fileName),
    );
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Accept-Ranges', 'bytes');
    if (inline && content.mimeType !== 'application/pdf') {
      // Opened on its own (not inside the app's <video>/<img>), the file may not run anything.
      response.setHeader('Content-Security-Policy', 'sandbox');
    }
    const range = parseByteRange(request.headers.range, info.size);
    if (range === 'unsatisfiable') {
      response.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      response.setHeader('Content-Range', `bytes */${info.size}`);
      response.end();
      return;
    }
    const stream = await withStorageErrors(() =>
      content.driver.openReadStream(content.key, range ?? undefined),
    );
    if (range) {
      response.status(HttpStatus.PARTIAL_CONTENT);
      response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
      response.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      response.status(HttpStatus.OK);
      response.setHeader('Content-Length', String(info.size));
    }
    try {
      await pipeline(stream, response);
    } catch {
      // The client went away (seeking, closing the tab): pipeline already stopped reading.
    }
  }

  /** Telegram's small preview of the file, from the thumbnail cache. */
  @Get(':id/thumbnail')
  async thumbnail(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.media.thumbnailFile(params.id);
    let bytes: Buffer;
    try {
      bytes = await readFile(file.path);
    } catch {
      throw new NotFoundException({
        code: ApiErrorCode.NOT_FOUND,
        message: 'This file has no preview.',
      });
    }
    response.status(HttpStatus.OK);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Previews never change: a browser may keep them a day (private: never a shared cache).
    response.setHeader('Cache-Control', 'private, max-age=86400');
    response.end(bytes);
  }

  /** Download this file now: 202 when it was queued, 200 when it is downloaded or downloading. */
  @Post(':id/download')
  async download(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Res({ passthrough: true }) response: Response,
  ): Promise<MediaDto> {
    const { media, queued } = await this.media.requestDownload(params.id);
    response.status(queued ? HttpStatus.ACCEPTED : HttpStatus.OK);
    return media;
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param({ schema: idParamSchema }) params: IdParam): Promise<MediaDto> {
    return this.media.cancel(params.id);
  }
}
