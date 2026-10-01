import path from 'node:path';
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  type OnApplicationBootstrap,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type StorageLocation } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  ApiErrorCode,
  BackupErrorCode,
  type CreateLocalLocationRequest,
  type CreateTelegramLocationRequest,
  DOWNLOAD_STORAGE_KINDS,
  type LocalFolderListDto,
  type StorageCapabilitiesDto,
  type StorageCheckDto,
  StorageErrorCode,
  StorageKind,
  type StorageLocationDto,
  type StorageLocationListDto,
  type StorageSpaceDto,
  type UpdateStorageLocationRequest,
} from '@tam/shared';
import {
  LocalFolderPolicy,
  LocalStorageDriver,
  StorageError,
  isDriverLocation,
  sanitizeName,
} from '@tam/storage';
import { StorageDrivers } from './storage-drivers.js';
import { withStorageErrors } from './storage-errors.js';
import { toStorageLocationDto } from './storage-location.mapper.js';
import { TelegramLocationsService } from './telegram-locations.service.js';
import {
  type StorageSettings,
  STORAGE_SETTINGS,
  googleDriveUnavailableReason,
} from './storage.settings.js';

const WITH_CHANNEL_COUNT = { _count: { select: { channels: true, backupChannels: true } } } as const;
type LocationWithCount = StorageLocation & {
  _count: { channels: number; backupChannels: number };
};

const BUILT_IN_NAME = 'This computer';

function inUseMessage(channels: number, media: number, backedUp: number, backups: number): string {
  if (channels > 0) {
    return `${channels} channel(s) save their media here. Choose another location for them first.`;
  }
  if (media > 0) {
    return `${media} archived file(s) are stored here, so the location must stay.`;
  }
  if (backedUp > 0) {
    return `${backedUp} channel(s) back up here. Choose another backup chat for them first.`;
  }
  return `${backups} message(s) were backed up here, so the chat must stay.`;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** A backup chat counts the channels backed up into it; a download location, those saving there. */
function toDto(location: LocationWithCount): StorageLocationDto {
  const count =
    location.kind === StorageKind.TELEGRAM
      ? location._count.backupChannels
      : location._count.channels;
  return toStorageLocationDto(location, count);
}

/**
 * Storage locations: the built-in folder from STORAGE_LOCAL_ROOT, folders people add inside the
 * allowed roots, Google Drive folders (connected by GoogleDriveConnectService), and Telegram chats
 * that receive backups (TelegramLocationsService).
 */
@Injectable()
export class StorageLocationsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(StorageLocationsService.name);
  private builtInReady: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SETTINGS) private readonly settings: StorageSettings,
    private readonly drivers: StorageDrivers,
    private readonly telegram: TelegramLocationsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.ensureBuiltIn().catch((error: unknown) => {
      this.logger.warn(`Could not set up the built-in storage location: ${String(error)}`);
    });
  }

  /** Keeps the built-in location in step with STORAGE_LOCAL_ROOT; retried after a failure. */
  ensureBuiltIn(): Promise<void> {
    this.builtInReady ??= this.syncBuiltIn().catch((error: unknown) => {
      this.builtInReady = null;
      throw error;
    });
    return this.builtInReady;
  }

  async list(): Promise<StorageLocationListDto> {
    await this.ensureBuiltIn().catch(() => undefined);
    const rows = await this.prisma.storageLocation.findMany({
      orderBy: [{ builtIn: 'desc' }, { createdAt: 'asc' }],
      include: WITH_CHANNEL_COUNT,
    });
    return { items: rows.map(toDto), capabilities: await this.capabilities() };
  }

  async capabilities(): Promise<StorageCapabilitiesDto> {
    const reason = googleDriveUnavailableReason(this.settings);
    const telegram = await this.telegram.unavailableReason();
    return {
      localRoots: [...this.settings.policy.roots],
      googleDrive: { available: reason === null, reason },
      telegram: { available: telegram === null, reason: telegram },
    };
  }

  /** Adds a Telegram chat of the account that receives backup copies of messages. */
  async createTelegram(request: CreateTelegramLocationRequest): Promise<StorageLocationDto> {
    const created = await this.telegram.create(request);
    return toDto(
      await this.prisma.storageLocation.findUniqueOrThrow({
        where: { id: created.id },
        include: WITH_CHANNEL_COUNT,
      }),
    );
  }

  browseLocal(folder?: string): Promise<LocalFolderListDto> {
    return withStorageErrors(() => this.settings.policy.list(folder));
  }

  /** Adds a folder on this computer after proving it can be written. */
  async createLocal(request: CreateLocalLocationRequest): Promise<StorageLocationDto> {
    const folder = await withStorageErrors(async () => {
      const base = await this.settings.policy.resolve(request.path);
      const target = request.subfolder
        ? await this.settings.policy.resolve(path.join(base, sanitizeName(request.subfolder, 100, 'Archive')))
        : base;
      await new LocalStorageDriver(target).probe();
      return target;
    });
    try {
      const location = await this.prisma.storageLocation.create({
        data: {
          kind: StorageKind.LOCAL,
          name: request.name,
          displayPath: folder,
          target: LocalFolderPolicy.identity(folder),
          config: { path: folder },
          lastCheckedAt: new Date(),
        },
        include: WITH_CHANNEL_COUNT,
      });
      return toDto(location);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: StorageErrorCode.LOCATION_EXISTS,
          message: 'Another storage location already uses this folder.',
        });
      }
      throw error;
    }
  }

  async update(id: string, request: UpdateStorageLocationRequest): Promise<StorageLocationDto> {
    const current = await this.find(id);
    if (request.isDefault && !isDriverLocation(current)) {
      throw new UnprocessableEntityException({
        code: BackupErrorCode.LOCATION_KIND_NOT_ALLOWED,
        message:
          'A Telegram backup chat holds no downloaded files, so it cannot be the default location.',
      });
    }
    const location = await this.prisma.$transaction(async (tx) => {
      if (request.isDefault) {
        await tx.storageLocation.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      return tx.storageLocation.update({
        where: { id },
        data: {
          ...(request.name === undefined ? {} : { name: request.name }),
          ...(request.isDefault ? { isDefault: true } : {}),
        },
        include: WITH_CHANNEL_COUNT,
      });
    });
    return toDto(location);
  }

  /**
   * Writes, reads back and removes a small file, then reports the free space. A Telegram backup
   * chat is read again instead, to see whether the account may still post there.
   */
  async check(id: string): Promise<StorageCheckDto> {
    const location = await this.find(id);
    if (!isDriverLocation(location)) {
      return this.checkTelegram(location);
    }
    let problem: string | null = null;
    let space: StorageSpaceDto | null = null;
    try {
      const driver = this.drivers.forLocation(location);
      await driver.probe();
      space = await driver.space();
    } catch (error) {
      if (!(error instanceof StorageError)) {
        throw error;
      }
      problem = error.message;
    }
    const updated = await this.prisma.storageLocation.update({
      where: { id },
      // A location that works again takes downloads at once, whatever made them wait.
      data: { lastError: problem, lastCheckedAt: new Date(), ...(problem === null ? { unavailableUntil: null } : {}) },
      include: WITH_CHANNEL_COUNT,
    });
    return { location: toDto(updated), ok: problem === null, space };
  }

  private async checkTelegram(location: StorageLocation): Promise<StorageCheckDto> {
    const { problem, config, displayPath } = await this.telegram.check(location);
    const updated = await this.prisma.storageLocation.update({
      where: { id: location.id },
      data: {
        lastError: problem,
        lastCheckedAt: new Date(),
        config: { ...config },
        displayPath,
        // A chat that works again takes backups at once, whatever made them wait.
        ...(problem === null ? { unavailableUntil: null } : {}),
      },
      include: WITH_CHANNEL_COUNT,
    });
    return { location: toDto(updated), ok: problem === null, space: null };
  }

  /**
   * Removes a location nothing uses; the files already in its folder stay where they are. A Google
   * grant is revoked so the app keeps no access it no longer needs.
   */
  async remove(id: string): Promise<void> {
    const location = await this.find(id);
    if (location.builtIn) {
      throw new ConflictException({
        code: StorageErrorCode.LOCATION_BUILT_IN,
        message: 'This location follows STORAGE_LOCAL_ROOT on the server and cannot be removed.',
      });
    }
    const [channels, media, backedUp, backups] = await Promise.all([
      this.prisma.channel.count({ where: { storageLocationId: id } }),
      this.prisma.media.count({ where: { storageLocationId: id } }),
      this.prisma.channel.count({ where: { backupLocationId: id } }),
      this.prisma.messageBackup.count({ where: { storageLocationId: id } }),
    ]);
    if (channels > 0 || media > 0 || backedUp > 0 || backups > 0) {
      throw new ConflictException({
        code: StorageErrorCode.LOCATION_IN_USE,
        message: inUseMessage(channels, media, backedUp, backups),
      });
    }
    if (location.kind === StorageKind.GOOGLE_DRIVE) {
      await this.revoke(location);
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.storageLocation.delete({ where: { id } });
      if (location.isDefault) {
        const next = await tx.storageLocation.findFirst({
          where: { kind: { in: [...DOWNLOAD_STORAGE_KINDS] } },
          orderBy: [{ builtIn: 'desc' }, { createdAt: 'asc' }],
        });
        if (next) {
          await tx.storageLocation.update({ where: { id: next.id }, data: { isDefault: true } });
        }
      }
    });
    this.drivers.forget(id);
  }

  async find(id: string): Promise<StorageLocation> {
    const location = await this.prisma.storageLocation.findUnique({ where: { id } });
    if (!location) {
      throw new NotFoundException({ code: ApiErrorCode.NOT_FOUND, message: 'Storage location not found' });
    }
    return location;
  }

  private async revoke(location: StorageLocation): Promise<void> {
    try {
      await this.drivers.oauth().revoke(this.drivers.refreshToken(location));
    } catch (error) {
      this.logger.warn(`Could not revoke the Google access of "${location.name}": ${String(error)}`);
    }
  }

  /**
   * One built-in location per STORAGE_LOCAL_ROOT. When the setting moves to another folder, the
   * old location stays as an ordinary one (its files remain reachable) and a new built-in one
   * takes over, including the default role.
   */
  private async syncBuiltIn(): Promise<void> {
    const root = this.settings.builtInRoot;
    if (root === null) {
      return;
    }
    const target = LocalFolderPolicy.identity(root);
    try {
      await this.prisma.$transaction(async (tx) => {
        const current = await tx.storageLocation.findFirst({ where: { builtIn: true } });
        if (current?.target === target && current.kind === StorageKind.LOCAL) {
          return;
        }
        const takeDefault =
          current?.isDefault === true || (await tx.storageLocation.count({ where: { isDefault: true } })) === 0;
        if (current) {
          await tx.storageLocation.update({
            where: { id: current.id },
            data: { builtIn: false, isDefault: takeDefault ? false : current.isDefault },
          });
        }
        const existing = await tx.storageLocation.findUnique({
          where: { kind_target: { kind: StorageKind.LOCAL, target } },
        });
        if (existing) {
          await tx.storageLocation.update({
            where: { id: existing.id },
            data: { builtIn: true, ...(takeDefault ? { isDefault: true } : {}) },
          });
          return;
        }
        await tx.storageLocation.create({
          data: {
            kind: StorageKind.LOCAL,
            name: BUILT_IN_NAME,
            displayPath: root,
            target,
            config: { path: root },
            builtIn: true,
            isDefault: takeDefault,
          },
        });
      });
    } catch (error) {
      // Another api process did the same at the same moment.
      if (!isUniqueViolation(error)) {
        throw error;
      }
    }
  }
}
