import type { Channel, StorageLocation } from '@tam/database';
import type { PrismaService } from '@tam/database/nest';
import { DOWNLOAD_SETTINGS_KEY, type DownloadSettings, MediaType } from '@tam/shared';
import { encodeFileId } from '@tam/telegram';
import type { MediaSettings } from '../../../src/media/media-settings.js';
import { dateOf } from './fake-chats.js';

/** Fast media settings for tests; nothing runs in the background unless a test asks for it. */
export function testMediaSettings(overrides: Partial<MediaSettings> = {}): MediaSettings {
  return {
    schedulerIntervalMs: 100,
    reconcileIntervalMs: 3_600_000,
    stallTimeoutMs: 5_000,
    maxAttempts: 3,
    retryBaseMs: 20,
    retryMaxMs: 100,
    unavailableRetryMs: 100,
    progressIntervalMs: 0,
    minFreeBytes: 0,
    stagingDir: null,
    thumbnailDir: null,
    thumbnailIntervalMs: 3_600_000,
    thumbnailTimeoutMs: 2_000,
    settingsCacheMs: 0,
    partRetentionMs: 14 * 24 * 60 * 60_000,
    lostAfterMs: 60_000,
    ...overrides,
  };
}

/** Media settings under which downloads stay idle (tests of other features). */
export const IDLE_MEDIA_SETTINGS = testMediaSettings({ schedulerIntervalMs: 3_600_000 });

/** The built-in "This computer" location in a test folder, as the api creates it. */
export function localLocation(
  prisma: PrismaService,
  root: string,
  overrides: { name?: string; isDefault?: boolean; builtIn?: boolean } = {},
): Promise<StorageLocation> {
  return prisma.storageLocation.create({
    data: {
      kind: 'LOCAL',
      name: 'This computer',
      displayPath: root,
      target: root.toLowerCase(),
      config: { path: root },
      isDefault: true,
      builtIn: true,
      ...overrides,
    },
  });
}

export async function saveDownloadSettings(
  prisma: PrismaService,
  settings: Partial<DownloadSettings>,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key: DOWNLOAD_SETTINGS_KEY },
    create: { key: DOWNLOAD_SETTINGS_KEY, value: settings },
    update: { value: settings },
  });
}

export interface ArchivedFile {
  messageId: number;
  size: number;
  fileUniqueId?: string;
  fileName?: string | null;
  type?: MediaType;
  mimeType?: string | null;
}

/** Media rows with a PENDING download job each, as an import records them. */
export async function archiveFiles(
  prisma: PrismaService,
  channel: Channel,
  files: readonly ArchivedFile[],
  importJobId: string | null = null,
): Promise<{ mediaId: string; downloadJobId: string; fileUniqueId: string }[]> {
  const chatId = channel.telegramChatId.toString();
  const created = [];
  for (const file of files) {
    const fileUniqueId = file.fileUniqueId ?? `file-${file.messageId}`;
    const message = await prisma.message.upsert({
      where: {
        channelId_telegramMessageId: { channelId: channel.id, telegramMessageId: file.messageId },
      },
      create: {
        channelId: channel.id,
        telegramMessageId: file.messageId,
        type: 'VIDEO',
        caption: `Lesson ${file.messageId}`,
        telegramDate: dateOf(file.messageId),
      },
      update: {},
    });
    const media = await prisma.media.create({
      data: {
        messageId: message.id,
        telegramFileId: encodeFileId({ chatId, messageId: String(file.messageId), fileUniqueId }),
        telegramFileUniqueId: fileUniqueId,
        type: file.type ?? MediaType.VIDEO,
        filename: file.fileName === undefined ? `lesson-${file.messageId}.mp4` : file.fileName,
        mimeType: file.mimeType === undefined ? 'video/mp4' : file.mimeType,
        size: BigInt(file.size),
      },
    });
    const job = await prisma.downloadJob.create({ data: { mediaId: media.id, importJobId } });
    created.push({ mediaId: media.id, downloadJobId: job.id, fileUniqueId });
  }
  return created;
}
