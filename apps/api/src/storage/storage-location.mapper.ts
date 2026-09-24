import type { StorageLocation } from '@tam/database';
import type { StorageLocationDto } from '@tam/shared';
import { z } from 'zod';

const localConfigSchema = z.object({ path: z.string().min(1) });
const googleDriveConfigSchema = z.object({
  folderId: z.string().min(1),
  folderName: z.string().min(1),
  accountEmail: z.string().nullable(),
});

export type LocalLocationConfig = z.infer<typeof localConfigSchema>;
export type GoogleDriveLocationConfig = z.infer<typeof googleDriveConfigSchema>;

export type LocationConfig =
  | ({ kind: 'LOCAL' } & LocalLocationConfig)
  | ({ kind: 'GOOGLE_DRIVE' } & GoogleDriveLocationConfig);

/** The non-secret settings stored in storage_locations.config, checked against the kind. */
export function locationConfig(location: Pick<StorageLocation, 'kind' | 'config'>): LocationConfig {
  return location.kind === 'LOCAL'
    ? { kind: 'LOCAL', ...localConfigSchema.parse(location.config) }
    : { kind: 'GOOGLE_DRIVE', ...googleDriveConfigSchema.parse(location.config) };
}

/** "My Drive › Unofficial Telegram Archive". */
export function driveDisplayPath(folderName: string): string {
  return `My Drive › ${folderName}`;
}

/** AAD of the sealed credentials: a ciphertext copied into another row does not decrypt. */
export function secretContext(locationId: string): string {
  return `storage_locations.secret:${locationId}`;
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
    channelCount,
    createdAt: location.createdAt.toISOString(),
  };
}
