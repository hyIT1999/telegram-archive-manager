import { z } from 'zod';
import type { ChatType, StorageKind } from '../enums.js';
import { telegramIdSchema } from './common.js';

/** Folder the app creates in My Drive when none is named. */
export const DEFAULT_DRIVE_FOLDER_NAME = 'Unofficial Telegram Archive';

/** The Telegram chat behind a backup location (kind TELEGRAM). */
export interface TelegramBackupChatDto {
  /** Marked chat id (-100…), for t.me links. */
  telegramChatId: string;
  type: ChatType;
  username: string | null;
  /** Forum topics of an archived forum are recreated in it. */
  isForum: boolean;
}

export interface StorageLocationDto {
  id: string;
  kind: StorageKind;
  name: string;
  /** Where files go, for people: an absolute folder, "My Drive › <folder>" or "Telegram › <chat>". */
  displayPath: string;
  /** The Google account the location writes with (Google Drive only). */
  accountEmail: string | null;
  /** The backup chat (Telegram only). */
  telegram: TelegramBackupChatDto | null;
  /** Used by channels that did not choose a location. */
  isDefault: boolean;
  /** Follows STORAGE_LOCAL_ROOT on the server; cannot be removed. */
  builtIn: boolean;
  /** Outcome of the last check, or why downloads to it wait; null when it worked (or never ran). */
  lastError: string | null;
  lastCheckedAt: string | null;
  /**
   * Downloads to this location (backups, for a Telegram chat) wait until then (full, rate
   * limited, access lost); see lastError.
   */
  unavailableUntil: string | null;
  /** Channels that save their media here, or back up here (Telegram). */
  channelCount: number;
  createdAt: string;
}

/** Null where the backend does not say (e.g. unlimited Drive plans). */
export interface StorageSpaceDto {
  freeBytes: number | null;
  totalBytes: number | null;
  usedBytes: number | null;
}

/** Result of POST /api/storage/locations/:id/check (a write, read and delete of a small file). */
export interface StorageCheckDto {
  location: StorageLocationDto;
  ok: boolean;
  space: StorageSpaceDto | null;
}

export interface StorageCapabilitiesDto {
  /** Folders under which "folder on this computer" locations may be created. */
  localRoots: string[];
  googleDrive: {
    available: boolean;
    /** Why not, when unavailable (server settings to add). */
    reason: string | null;
  };
  /** Backup chats need the archive's Telegram account to be signed in. */
  telegram: {
    available: boolean;
    reason: string | null;
  };
}

export interface StorageLocationListDto {
  items: StorageLocationDto[];
  capabilities: StorageCapabilitiesDto;
}

export const storageLocationNameSchema = z.string().trim().min(1).max(80);

/** One folder name typed by a person; the server turns it into a safe name. */
const folderNameSchema = z.string().trim().min(1).max(100);

/** POST /api/storage/locations — a folder on the machine running the archive. */
export const createLocalLocationRequestSchema = z.object({
  name: storageLocationNameSchema,
  /** An absolute folder inside one of the allowed roots (usually picked in the folder browser). */
  path: z.string().trim().min(1).max(1_024),
  /** Optional new folder to create inside `path`. */
  subfolder: folderNameSchema.optional(),
});
export type CreateLocalLocationRequest = z.infer<typeof createLocalLocationRequestSchema>;

/**
 * POST /api/storage/telegram — a Telegram chat of the account (from its chat list) that receives
 * backup copies. The worker checks that the account may post there (and create topics in a forum).
 */
export const createTelegramLocationRequestSchema = z.object({
  telegramChatId: telegramIdSchema,
  /** Defaults to the chat's title. */
  name: storageLocationNameSchema.optional(),
});
export type CreateTelegramLocationRequest = z.infer<typeof createTelegramLocationRequestSchema>;

/** GET /api/storage/local/folders?path= — without a path, lists the allowed roots. */
export const localFoldersQuerySchema = z.object({
  path: z.string().trim().min(1).max(1_024).optional(),
});
export type LocalFoldersQuery = z.infer<typeof localFoldersQuerySchema>;

export interface LocalFolderDto {
  name: string;
  path: string;
}

export interface LocalFolderListDto {
  /** The listed folder; null for the list of allowed roots. */
  path: string | null;
  /** Where "up" leads; null at a root. */
  parent: string | null;
  folders: LocalFolderDto[];
  truncated: boolean;
}

/** POST /api/storage/google/connect — starts the device-code flow (google.com/device). */
export const connectGoogleDriveRequestSchema = z.object({
  name: storageLocationNameSchema,
  /** The folder the app creates (or reuses) in My Drive. */
  folderName: folderNameSchema.default(DEFAULT_DRIVE_FOLDER_NAME),
  /** Reconnect this existing Google Drive location instead of adding a new one. */
  locationId: z.uuid().optional(),
});
export type ConnectGoogleDriveRequest = z.infer<typeof connectGoogleDriveRequestSchema>;

export interface GoogleDriveConnectDto {
  flowId: string;
  /** The code the person types on the verification page. */
  userCode: string;
  verificationUrl: string;
  expiresAt: string;
  /** Poll no more often than this. */
  intervalSeconds: number;
}

export const googleDriveFlowParamSchema = z.object({ flowId: z.uuid() });
export type GoogleDriveFlowParam = z.infer<typeof googleDriveFlowParamSchema>;

export type GoogleDriveConnectStatus = 'pending' | 'authorized' | 'denied' | 'expired';

export interface GoogleDrivePollDto {
  status: GoogleDriveConnectStatus;
  /** The created or reconnected location, once authorized. */
  location: StorageLocationDto | null;
  /** While pending: wait this long before the next poll (Google may ask to slow down). */
  intervalSeconds: number | null;
}

/** PATCH /api/storage/locations/:id */
export const updateStorageLocationRequestSchema = z
  .object({
    name: storageLocationNameSchema.optional(),
    /** Only `true`: another location becomes the default by choosing it. */
    isDefault: z.literal(true).optional(),
  })
  .refine((value) => value.name !== undefined || value.isDefault !== undefined, {
    message: 'Nothing to change',
  });
export type UpdateStorageLocationRequest = z.infer<typeof updateStorageLocationRequestSchema>;
