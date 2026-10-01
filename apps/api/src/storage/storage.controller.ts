import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import {
  type ConnectGoogleDriveRequest,
  type CreateLocalLocationRequest,
  type CreateTelegramLocationRequest,
  type GoogleDriveConnectDto,
  type GoogleDriveFlowParam,
  type GoogleDrivePollDto,
  type IdParam,
  type LocalFolderListDto,
  type LocalFoldersQuery,
  type StorageCheckDto,
  type StorageLocationDto,
  type StorageLocationListDto,
  type UpdateStorageLocationRequest,
  connectGoogleDriveRequestSchema,
  createLocalLocationRequestSchema,
  createTelegramLocationRequestSchema,
  googleDriveFlowParamSchema,
  idParamSchema,
  localFoldersQuerySchema,
  updateStorageLocationRequestSchema,
} from '@tam/shared';
import { GoogleDriveConnectService } from './google-drive-connect.service.js';
import { StorageLocationsService } from './storage-locations.service.js';

/** Google sign-ins started per client IP and minute. */
export const GOOGLE_CONNECT_THROTTLE = { limit: 10, ttl: 60_000 } as const;

@Controller('storage')
export class StorageController {
  constructor(
    private readonly locations: StorageLocationsService,
    private readonly google: GoogleDriveConnectService,
  ) {}

  /** Every location, and what the server allows adding (local roots, Google Drive). */
  @Get('locations')
  list(): Promise<StorageLocationListDto> {
    return this.locations.list();
  }

  /** Adds a folder on this computer (inside the allowed roots). */
  @Post('locations')
  createLocal(
    @Body({ schema: createLocalLocationRequestSchema }) request: CreateLocalLocationRequest,
  ): Promise<StorageLocationDto> {
    return this.locations.createLocal(request);
  }

  /**
   * Adds a Telegram chat of the account (from its chat list) that receives backup copies. The
   * worker reads the chat first: the account must be allowed to post (and to create topics in a
   * forum), and the chat must not be archived itself.
   */
  @Post('telegram')
  createTelegram(
    @Body({ schema: createTelegramLocationRequestSchema }) request: CreateTelegramLocationRequest,
  ): Promise<StorageLocationDto> {
    return this.locations.createTelegram(request);
  }

  @Patch('locations/:id')
  update(
    @Param({ schema: idParamSchema }) params: IdParam,
    @Body({ schema: updateStorageLocationRequestSchema }) request: UpdateStorageLocationRequest,
  ): Promise<StorageLocationDto> {
    return this.locations.update(params.id, request);
  }

  /** Writes, reads back and removes a small file; reports the free space. */
  @Post('locations/:id/check')
  @HttpCode(HttpStatus.OK)
  check(@Param({ schema: idParamSchema }) params: IdParam): Promise<StorageCheckDto> {
    return this.locations.check(params.id);
  }

  @Delete('locations/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param({ schema: idParamSchema }) params: IdParam): Promise<void> {
    return this.locations.remove(params.id);
  }

  /** Subfolders of a folder inside the allowed roots; the roots themselves without `path`. */
  @Get('local/folders')
  folders(@Query({ schema: localFoldersQuerySchema }) query: LocalFoldersQuery): Promise<LocalFolderListDto> {
    return this.locations.browseLocal(query.path);
  }

  /** Starts a Google sign-in with a code for google.com/device. */
  @Throttle({ default: GOOGLE_CONNECT_THROTTLE })
  @Post('google/connect')
  connectGoogle(
    @Body({ schema: connectGoogleDriveRequestSchema }) request: ConnectGoogleDriveRequest,
  ): Promise<GoogleDriveConnectDto> {
    return this.google.start(request);
  }

  /** Whether the person approved yet; creates the location once they did. */
  @Post('google/connect/:flowId/poll')
  @HttpCode(HttpStatus.OK)
  pollGoogle(@Param({ schema: googleDriveFlowParamSchema }) params: GoogleDriveFlowParam): Promise<GoogleDrivePollDto> {
    return this.google.poll(params.flowId);
  }
}
