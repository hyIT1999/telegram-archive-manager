import type { Channel, ImportJob } from '@tam/database';
import { describe, expect, it } from 'vitest';
import { toImportJobDto } from '../../src/imports/import-job.mapper.js';

const created = new Date('2026-09-24T10:00:00.000Z');

const channel: Channel = {
  id: '0199a0b1-0000-7000-8000-000000000001',
  telegramChatId: -1001234567890n,
  title: 'Physics',
  username: 'physics',
  type: 'CHANNEL',
  accessHash: 42n,
  isForum: false,
  isProtected: false,
  memberCount: 100,
  syncEnabled: false,
  headMessageId: 500,
  backfillCursorId: 1,
  backfillComplete: true,
  lastSyncedAt: null,
  migratedFromChatId: null,
  migratedToChannelId: null,
  storageLocationId: null,
  storageFolder: null,
  downloadMedia: true,
  downloadNote: null,
  createdAt: created,
  updatedAt: created,
};

const job: ImportJob = {
  id: '0199a0b1-0000-7000-8000-0000000000aa',
  channelId: channel.id,
  parentImportJobId: null,
  type: 'IMPORT',
  mode: 'FROM_DATE',
  fromDate: new Date('2026-09-01T00:00:00.000Z'),
  status: 'RUNNING',
  phase: 'HISTORY',
  runSeq: 2,
  bullJobId: 'ij-0199a0b1-0000-7000-8000-0000000000aa-2',
  totalMessages: 800,
  processedMessages: 300,
  totalMedia: 40,
  downloadedFiles: 0,
  failedFiles: 0,
  skippedFiles: 0,
  totalBytes: 6n * 1024n ** 3n,
  downloadedBytes: 0n,
  currentFile: null,
  statusDetail: 'Telegram asked to wait 30 s before reading more',
  error: null,
  startedAt: created,
  messagesCompletedAt: null,
  completedAt: null,
  createdAt: created,
  updatedAt: created,
};

describe('toImportJobDto', () => {
  it('names the channel, turns BIGINT counters into numbers and keeps run details private', () => {
    const dto = toImportJobDto({ ...job, channel });
    expect(dto).toMatchObject({
      id: job.id,
      channel: {
        id: channel.id,
        telegramChatId: '-1001234567890',
        title: 'Physics',
        username: 'physics',
        type: 'CHANNEL',
      },
      mode: 'FROM_DATE',
      fromDate: '2026-09-01T00:00:00.000Z',
      totalBytes: 6 * 1024 ** 3,
      downloadedBytes: 0,
      statusDetail: 'Telegram asked to wait 30 s before reading more',
      startedAt: created.toISOString(),
      completedAt: null,
    });
    // The run number and BullMQ id are the worker's business.
    expect(dto).not.toHaveProperty('runSeq');
    expect(dto).not.toHaveProperty('bullJobId');
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
});
