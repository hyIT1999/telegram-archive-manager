import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DRIVE_FOLDER_NAME,
  StorageErrorCode,
  StorageKind,
  connectGoogleDriveRequestSchema,
  createLocalLocationRequestSchema,
  googleDriveFlowParamSchema,
  localFoldersQuerySchema,
  updateChannelRequestSchema,
  updateStorageLocationRequestSchema,
} from '../src/index.js';

describe('storage location contracts', () => {
  it('mirrors the database enum', () => {
    expect(Object.values(StorageKind)).toEqual(['LOCAL', 'GOOGLE_DRIVE']);
    expect(StorageErrorCode.PATH_NOT_ALLOWED).toBe('PATH_NOT_ALLOWED');
  });

  it('trims local location requests and requires a name and a path', () => {
    expect(
      createLocalLocationRequestSchema.parse({ name: '  Archive  ', path: ' D:\\Telegram ', subfolder: ' New ' }),
    ).toEqual({ name: 'Archive', path: 'D:\\Telegram', subfolder: 'New' });
    expect(createLocalLocationRequestSchema.safeParse({ name: '', path: '/data' }).success).toBe(false);
    expect(createLocalLocationRequestSchema.safeParse({ name: 'x', path: '   ' }).success).toBe(false);
    expect(createLocalLocationRequestSchema.safeParse({ name: 'x'.repeat(81), path: '/data' }).success).toBe(false);
  });

  it('lists the roots when no folder is given', () => {
    expect(localFoldersQuerySchema.parse({})).toEqual({});
    expect(localFoldersQuerySchema.parse({ path: ' /data ' })).toEqual({ path: '/data' });
  });

  it('defaults the Drive folder name and accepts a location to reconnect', () => {
    expect(connectGoogleDriveRequestSchema.parse({ name: 'Drive' })).toEqual({
      name: 'Drive',
      folderName: DEFAULT_DRIVE_FOLDER_NAME,
    });
    const reconnect = connectGoogleDriveRequestSchema.safeParse({
      name: 'Drive',
      folderName: 'Lessons',
      locationId: '0199a0b1-0000-7000-8000-000000000001',
    });
    expect(reconnect.success).toBe(true);
    expect(connectGoogleDriveRequestSchema.safeParse({ name: 'Drive', locationId: 'nope' }).success).toBe(false);
    expect(googleDriveFlowParamSchema.safeParse({ flowId: 'not-a-uuid' }).success).toBe(false);
  });

  it('only lets a location become the default, and requires a change', () => {
    expect(updateStorageLocationRequestSchema.parse({ isDefault: true })).toEqual({ isDefault: true });
    expect(updateStorageLocationRequestSchema.safeParse({ isDefault: false }).success).toBe(false);
    expect(updateStorageLocationRequestSchema.safeParse({}).success).toBe(false);
    expect(updateStorageLocationRequestSchema.parse({ name: ' Photos ' })).toEqual({ name: 'Photos' });
  });

  it('assigns a channel to a location by id', () => {
    expect(updateChannelRequestSchema.safeParse({ storageLocationId: 'x' }).success).toBe(false);
    expect(
      updateChannelRequestSchema.parse({ storageLocationId: '0199a0b1-0000-7000-8000-000000000001' }),
    ).toEqual({ storageLocationId: '0199a0b1-0000-7000-8000-000000000001' });
  });
});
