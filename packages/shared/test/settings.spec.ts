import { describe, expect, it } from 'vitest';
import {
  DOWNLOAD_JOB_NAME,
  MAX_DOWNLOAD_CONCURRENCY,
  MediaType,
  defaultDownloadSettings,
  downloadJobOptions,
  isAutoDownloaded,
  readDownloadSettings,
  updateSettingsRequestSchema,
} from '../src/index.js';

const MIB = 1024 * 1024;

describe('download settings', () => {
  it('downloads everything by default, two files at a time', () => {
    expect(defaultDownloadSettings()).toEqual({
      paused: false,
      mediaTypes: Object.values(MediaType),
      maxFileSizeMb: null,
      concurrency: 2,
    });
  });

  it('fills fields missing from stored settings and ignores unreadable ones', () => {
    expect(readDownloadSettings({ paused: true })).toEqual({
      ...defaultDownloadSettings(),
      paused: true,
    });
    expect(readDownloadSettings(null)).toEqual(defaultDownloadSettings());
    expect(readDownloadSettings({ concurrency: 99 })).toEqual(defaultDownloadSettings());
  });

  it('decides automatic downloads by type and size', () => {
    const settings = { mediaTypes: [MediaType.DOCUMENT, MediaType.VIDEO], maxFileSizeMb: 200 };
    expect(isAutoDownloaded(settings, { type: MediaType.VIDEO, size: 200 * MIB })).toBe(true);
    expect(isAutoDownloaded(settings, { type: MediaType.VIDEO, size: 200 * MIB + 1 })).toBe(false);
    expect(isAutoDownloaded(settings, { type: MediaType.PHOTO, size: 10 })).toBe(false);
    expect(isAutoDownloaded(settings, { type: MediaType.DOCUMENT, size: null })).toBe(true);
    expect(
      isAutoDownloaded({ ...settings, maxFileSizeMb: null }, { type: MediaType.VIDEO, size: 5e12 }),
    ).toBe(true);
  });

  it('changes only the given fields and refuses empty or invalid changes', () => {
    expect(updateSettingsRequestSchema.parse({ downloads: { paused: true } })).toEqual({
      downloads: { paused: true },
    });
    expect(
      updateSettingsRequestSchema.parse({ downloads: { mediaTypes: ['VIDEO', 'VIDEO', 'PHOTO'] } }),
    ).toEqual({ downloads: { mediaTypes: ['VIDEO', 'PHOTO'] } });
    expect(updateSettingsRequestSchema.parse({ downloads: { maxFileSizeMb: null } })).toEqual({
      downloads: { maxFileSizeMb: null },
    });
    expect(updateSettingsRequestSchema.safeParse({ downloads: {} }).success).toBe(false);
    expect(
      updateSettingsRequestSchema.safeParse({
        downloads: { concurrency: MAX_DOWNLOAD_CONCURRENCY + 1 },
      }).success,
    ).toBe(false);
    expect(updateSettingsRequestSchema.safeParse({ downloads: { maxFileSizeMb: 0 } }).success).toBe(
      false,
    );
    expect(
      updateSettingsRequestSchema.safeParse({ downloads: { mediaTypes: ['PDF'] } }).success,
    ).toBe(false);
  });
});

describe('downloadJobOptions', () => {
  it('gives every try its own id and leaves retries to the database', () => {
    const options = downloadJobOptions('0199a0b1-0000-7000-8000-000000000001', 4);
    expect(DOWNLOAD_JOB_NAME).toBe('download');
    expect(options.jobId).toBe('dl-0199a0b1-0000-7000-8000-000000000001-4');
    expect(options.attempts).toBe(1);
    expect(options.removeOnComplete).toBe(true);
  });
});
