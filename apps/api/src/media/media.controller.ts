import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { Readable } from 'node:stream';
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
import type { StoredObjectInfo } from '@tam/storage';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { withStorageErrors } from '../storage/storage-errors.js';
import { ifRangeMatches, parseByteRange } from './byte-range.js';
import { contentDisposition, isInlineType } from './content-disposition.js';
import { MediaService, type StoredContent } from './media.service.js';

/** `?download=1` asks for a download even for files browsers can show. */
const contentQuerySchema = z.object({
  download: z
    .enum(['0', '1', 'false', 'true'])
    .transform((value) => value === '1' || value === 'true')
    .optional(),
});
type ContentQuery = z.infer<typeof contentQuerySchema>;

/**
 * A stored file never changes once downloaded, but every read still checks the session:
 * the browser keeps it and asks again with If-None-Match, answered with 304 and no body.
 */
const CONTENT_CACHE_CONTROL = 'private, no-cache';
/** Previews never change: a browser may keep them a day (private: never a shared cache). */
const THUMBNAIL_CACHE_CONTROL = 'private, max-age=86400';

/** Strong when the checksum of the stored bytes is known, weak (size and date) otherwise. */
function contentEtag(content: StoredContent, info: StoredObjectInfo): string {
  if (content.checksum) {
    return `"${content.checksum}"`;
  }
  return `W/"${info.size.toString(16)}-${(info.modifiedAt?.getTime() ?? 0).toString(16)}"`;
}

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
   * The stored file, whole (200) or a byte range of it (206, 416 outside the file), or 304 when
   * the browser already has it. Only images, browser video/audio and PDF are shown inline;
   * anything else downloads, and nothing is ever sniffed into another type. HEAD reads nothing.
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
    const etag = contentEtag(content, info);
    const lastModified = info.modifiedAt ?? null;
    const inline = query.download !== true && isInlineType(content.mimeType);
    response.setHeader('Cache-Control', CONTENT_CACHE_CONTROL);
    response.setHeader('ETag', etag);
    if (lastModified) {
      response.setHeader('Last-Modified', lastModified.toUTCString());
    }
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
    if (request.fresh) {
      response.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }

    const range = ifRangeMatches(request.get('If-Range'), etag, lastModified)
      ? parseByteRange(request.headers.range, info.size)
      : null;
    if (range === 'unsatisfiable') {
      response.status(HttpStatus.REQUESTED_RANGE_NOT_SATISFIABLE);
      response.setHeader('Content-Range', `bytes */${info.size}`);
      response.end();
      return;
    }
    if (range) {
      response.status(HttpStatus.PARTIAL_CONTENT);
      response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${info.size}`);
      response.setHeader('Content-Length', String(range.end - range.start + 1));
    } else {
      response.status(HttpStatus.OK);
      response.setHeader('Content-Length', String(info.size));
    }
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = await withStorageErrors(() =>
      content.driver.openReadStream(content.key, range ?? undefined, info),
    );
    await send(stream, response);
  }

  /** Telegram's small preview of the file, from the thumbnail cache. */
  @Get(':id/thumbnail')
  async thumbnail(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const file = await this.media.thumbnailFile(params.id);
    const info = await stat(file.path).catch(() => null);
    if (!info?.isFile()) {
      throw new NotFoundException({
        code: ApiErrorCode.NOT_FOUND,
        message: 'This file has no preview.',
      });
    }
    response.setHeader('Cache-Control', THUMBNAIL_CACHE_CONTROL);
    response.setHeader(
      'ETag',
      `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`,
    );
    response.setHeader('Last-Modified', info.mtime.toUTCString());
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (request.fresh) {
      response.status(HttpStatus.NOT_MODIFIED).end();
      return;
    }
    response.status(HttpStatus.OK);
    response.setHeader('Content-Length', String(info.size));
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    await send(createReadStream(file.path), response);
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

async function send(stream: Readable, response: Response): Promise<void> {
  try {
    await pipeline(stream, response);
  } catch {
    // The client went away (seeking, closing the tab): pipeline already stopped reading.
  }
}
