import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  ApiErrorCode,
  type ConnectGoogleDriveRequest,
  DEFAULT_DRIVE_FOLDER_NAME,
  type GoogleDriveConnectDto,
  type GoogleDrivePollDto,
  StorageErrorCode,
  StorageKind,
  type StorageLocationDto,
} from '@tam/shared';
import {
  DRIVE_FILE_SCOPE,
  type GoogleDriveApi,
  type GoogleTokens,
  ensureTopFolder,
  sanitizeName,
  staticAccessToken,
} from '@tam/storage';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { REDIS_CLIENT } from '../redis/redis.constants.js';
import { StorageDrivers } from './storage-drivers.js';
import { withStorageErrors } from './storage-errors.js';
import { driveDisplayPath, locationConfig, toStorageLocationDto } from './storage-location.mapper.js';

const FLOW_KEY_PREFIX = 'tam:storage:google-flow:';
/** Only one poll of a flow at a time, so a device code is never redeemed twice. */
const POLL_LOCK_MS = 30_000;

/** A sign-in in progress; the device code stays on the server (Redis, until it expires). */
const flowSchema = z.object({
  deviceCode: z.string(),
  intervalSeconds: z.number(),
  name: z.string(),
  folderName: z.string(),
  locationId: z.string().nullable(),
});
type Flow = z.infer<typeof flowSchema>;

function flowKey(flowId: string): string {
  return `${FLOW_KEY_PREFIX}${flowId}`;
}

/**
 * Connects Google Drive with the device-code flow: the person opens google.com/device, types the
 * code and approves; the browser polls until then. The refresh token is sealed with
 * STORAGE_SECRET_KEY and never sent to the browser.
 */
@Injectable()
export class GoogleDriveConnectService {
  private readonly logger = new Logger(GoogleDriveConnectService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly drivers: StorageDrivers,
  ) {}

  async start(request: ConnectGoogleDriveRequest): Promise<GoogleDriveConnectDto> {
    const oauth = await withStorageErrors(async () => this.drivers.oauth());
    if (request.locationId !== undefined) {
      const location = await this.prisma.storageLocation.findUnique({ where: { id: request.locationId } });
      if (location?.kind !== StorageKind.GOOGLE_DRIVE) {
        throw new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: 'Storage location not found' });
      }
    }
    const device = await withStorageErrors(() => oauth.startDeviceAuthorization());
    const flowId = randomUUID();
    const flow: Flow = {
      deviceCode: device.deviceCode,
      intervalSeconds: device.intervalSeconds,
      name: request.name,
      folderName: sanitizeName(request.folderName, 100, DEFAULT_DRIVE_FOLDER_NAME),
      locationId: request.locationId ?? null,
    };
    await this.redis.set(flowKey(flowId), JSON.stringify(flow), 'PX', device.expiresInSeconds * 1000);
    return {
      flowId,
      userCode: device.userCode,
      verificationUrl: device.verificationUrl,
      expiresAt: new Date(Date.now() + device.expiresInSeconds * 1000).toISOString(),
      intervalSeconds: device.intervalSeconds,
    };
  }

  /** One check with Google; the browser calls it every `intervalSeconds` until it is settled. */
  async poll(flowId: string): Promise<GoogleDrivePollDto> {
    const key = flowKey(flowId);
    const locked = await this.redis.set(`${key}:lock`, '1', 'PX', POLL_LOCK_MS, 'NX');
    if (locked === null) {
      return { status: 'pending', location: null, intervalSeconds: null };
    }
    try {
      const raw = await this.redis.get(key);
      if (raw === null) {
        throw new NotFoundException({
          code: ApiErrorCode.NOT_FOUND,
          message: 'This Google sign-in expired or is already finished. Start again.',
        });
      }
      const flow = flowSchema.parse(JSON.parse(raw));
      const oauth = await withStorageErrors(async () => this.drivers.oauth());
      const result = await withStorageErrors(() => oauth.pollDeviceAuthorization(flow.deviceCode));
      switch (result.status) {
        case 'pending':
        case 'slow_down': {
          if (result.status === 'slow_down') {
            flow.intervalSeconds += 5;
            await this.redis.set(key, JSON.stringify(flow), 'KEEPTTL');
          }
          return { status: 'pending', location: null, intervalSeconds: flow.intervalSeconds };
        }
        case 'denied':
        case 'expired':
          await this.redis.del(key);
          return { status: result.status, location: null, intervalSeconds: null };
        case 'authorized': {
          // Redeemed: the flow is over whatever happens next.
          await this.redis.del(key);
          const location = await this.finish(flow, result.tokens);
          return { status: 'authorized', location, intervalSeconds: null };
        }
      }
    } finally {
      await this.redis.del(`${key}:lock`);
    }
  }

  private async finish(flow: Flow, tokens: GoogleTokens): Promise<StorageLocationDto> {
    if (!tokens.scopes.includes(DRIVE_FILE_SCOPE)) {
      await this.revokeQuietly(tokens.refreshToken);
      throw new UnprocessableEntityException({
        code: StorageErrorCode.GOOGLE_SCOPE_DENIED,
        message:
          'Google Drive access was not allowed. Start again and keep the Google Drive permission ticked.',
      });
    }
    const drive = this.drivers.driveApi(staticAccessToken(tokens.accessToken));
    return withStorageErrors(async () => {
      if (flow.locationId !== null) {
        return this.reconnect(flow.locationId, tokens, drive);
      }
      const folder = await ensureTopFolder(drive, flow.folderName);
      const config = { folderId: folder.id, folderName: folder.name, accountEmail: tokens.email };
      const existing = await this.prisma.storageLocation.findUnique({
        where: { kind_target: { kind: StorageKind.GOOGLE_DRIVE, target: folder.id } },
      });
      if (existing) {
        // The same folder connected again: keep the location, refresh its credentials.
        return this.storeCredentials(existing.id, tokens.refreshToken, { config });
      }
      try {
        const created = await this.prisma.storageLocation.create({
          data: {
            kind: StorageKind.GOOGLE_DRIVE,
            name: flow.name,
            displayPath: driveDisplayPath(folder.name),
            target: folder.id,
            config,
          },
        });
        return await this.storeCredentials(created.id, tokens.refreshToken, {});
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const other = await this.prisma.storageLocation.findUniqueOrThrow({
            where: { kind_target: { kind: StorageKind.GOOGLE_DRIVE, target: folder.id } },
          });
          return this.storeCredentials(other.id, tokens.refreshToken, { config });
        }
        throw error;
      }
    });
  }

  /** A location keeps its folder: the new sign-in must be able to open it. */
  private async reconnect(
    locationId: string,
    tokens: GoogleTokens,
    drive: GoogleDriveApi,
  ): Promise<StorageLocationDto> {
    const location = await this.prisma.storageLocation.findUnique({ where: { id: locationId } });
    if (location?.kind !== StorageKind.GOOGLE_DRIVE) {
      throw new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: 'Storage location not found' });
    }
    const config = locationConfig(location);
    if (config.kind !== 'GOOGLE_DRIVE') {
      throw new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: 'Storage location not found' });
    }
    const folder = await drive.getFile(config.folderId);
    if (!folder || folder.trashed) {
      await this.revokeQuietly(tokens.refreshToken);
      throw new UnprocessableEntityException({
        code: StorageErrorCode.STORAGE_NOT_WRITABLE,
        message: `This Google account cannot open the folder "${config.folderName}". Sign in with ${
          config.accountEmail ?? 'the account that created the location'
        }, or add a new Google Drive location.`,
      });
    }
    return this.storeCredentials(location.id, tokens.refreshToken, {
      config: {
        folderId: config.folderId,
        folderName: config.folderName,
        accountEmail: tokens.email ?? config.accountEmail,
      },
    });
  }

  private async storeCredentials(
    locationId: string,
    refreshToken: string,
    changes: { config?: Prisma.InputJsonObject },
  ): Promise<StorageLocationDto> {
    const location = await this.prisma.storageLocation.update({
      where: { id: locationId },
      data: {
        secretEnc: this.drivers.seal(locationId, refreshToken),
        ...(changes.config === undefined ? {} : { config: changes.config }),
        lastError: null,
        lastCheckedAt: new Date(),
      },
      include: { _count: { select: { channels: true } } },
    });
    this.drivers.forget(locationId);
    return toStorageLocationDto(location, location._count.channels);
  }

  private async revokeQuietly(refreshToken: string): Promise<void> {
    try {
      await this.drivers.oauth().revoke(refreshToken);
    } catch (error) {
      this.logger.warn(`Could not revoke an unused Google grant: ${String(error)}`);
    }
  }
}
