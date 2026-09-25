import type { StorageLocation } from '@tam/database';
import type { StorageLocationDto } from '@tam/shared';
import { locationConfig } from '@tam/storage';

/** "My Drive › Unofficial Telegram Archive". */
export function driveDisplayPath(folderName: string): string {
  return `My Drive › ${folderName}`;
}

/** Never includes the sealed credentials. */
export function toStorageLocationDto(location: StorageLocation, channelCount: number): StorageLocationDto {
  const config = locationConfig(location);
  return {
    id: location.id,
    kind: location.kind,
    name: location.name,
    displayPath: location.displayPath,
    accountEmail: config.kind === 'GOOGLE_DRIVE' ? config.accountEmail : null,
    isDefault: location.isDefault,
    builtIn: location.builtIn,
    lastError: location.lastError,
    lastCheckedAt: location.lastCheckedAt?.toISOString() ?? null,
    unavailableUntil: location.unavailableUntil?.toISOString() ?? null,
    channelCount,
    createdAt: location.createdAt.toISOString(),
  };
}
