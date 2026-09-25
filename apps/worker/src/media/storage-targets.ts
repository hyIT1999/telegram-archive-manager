import { Inject, Injectable } from '@nestjs/common';
import type { Channel, StorageLocation } from '@tam/database';
import { PrismaService } from '@tam/database/nest';
import {
  type LocationDriverFactory,
  type StorageDriver,
  StorageUnavailableError,
  channelFolderName,
} from '@tam/storage';
import { LOCATION_DRIVERS, MEDIA_SETTINGS, type MediaSettings } from './media-settings.js';

/** A storage location cannot be used right now (its settings, credentials, the server's setup). */
export class LocationError extends Error {
  constructor(
    readonly location: StorageLocation,
    cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'LocationError';
  }
}

/** Where a channel's file goes. */
export interface StorageTarget {
  location: StorageLocation;
  driver: StorageDriver;
  /** The channel's folder inside the location ("Title (chat id)"). */
  folder: string;
  /** Where the file is downloaded to before it is stored. */
  stagingDir: string;
}

/**
 * Resolves the storage location of a channel (its own, else the default one) and the driver
 * that reaches it. Channels that never chose a location get their folder name fixed here, the
 * same way choosing a location does.
 */
@Injectable()
export class StorageTargets {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(LOCATION_DRIVERS) private readonly drivers: LocationDriverFactory,
    @Inject(MEDIA_SETTINGS) private readonly settings: MediaSettings,
  ) {}

  /** Null when the channel has no location and none is the default. */
  async resolve(channel: Channel): Promise<StorageTarget | null> {
    const location =
      channel.storageLocationId === null
        ? await this.prisma.storageLocation.findFirst({ where: { isDefault: true } })
        : await this.prisma.storageLocation.findUnique({
            where: { id: channel.storageLocationId },
          });
    if (!location) {
      return null;
    }
    let driver: StorageDriver;
    let stagingDir: string | null;
    try {
      driver = this.drivers.forLocation(location);
      stagingDir = driver.stagingDir() ?? this.settings.stagingDir;
      if (stagingDir === null) {
        throw new StorageUnavailableError(
          'Set DOWNLOAD_STAGING_DIR (or STORAGE_LOCAL_ROOT) for the worker: files for Google Drive wait there before the upload.',
        );
      }
    } catch (error) {
      throw new LocationError(location, error);
    }
    return { location, driver, folder: await this.folderOf(channel), stagingDir };
  }

  /** Staging folders of every location on this server, plus the one for Google Drive. */
  async stagingDirs(): Promise<string[]> {
    const locations = await this.prisma.storageLocation.findMany({ where: { kind: 'LOCAL' } });
    const dirs = new Set<string>();
    for (const location of locations) {
      try {
        const dir = this.drivers.forLocation(location).stagingDir();
        if (dir) {
          dirs.add(dir);
        }
      } catch {
        // A location with broken settings has nothing to clean up.
      }
    }
    if (this.settings.stagingDir) {
      dirs.add(this.settings.stagingDir);
    }
    return [...dirs];
  }

  private async folderOf(channel: Channel): Promise<string> {
    if (channel.storageFolder !== null) {
      return channel.storageFolder;
    }
    const folder = channelFolderName(channel.title, channel.telegramChatId.toString());
    await this.prisma.channel.updateMany({
      where: { id: channel.id, storageFolder: null },
      data: { storageFolder: folder },
    });
    const stored = await this.prisma.channel.findUnique({
      where: { id: channel.id },
      select: { storageFolder: true },
    });
    return stored?.storageFolder ?? folder;
  }
}
