import type { Channel, Message, Prisma, PrismaClient } from '@tam/database';

const SIX_HOURS = 6 * 3_600_000;

/** Message `id` is posted 6 hours after message `id - 1`, starting at 2026-01-01 00:00 UTC. */
export function postedAt(id: number): Date {
  return new Date(Date.UTC(2026, 0, 1) + id * SIX_HOURS);
}

export interface FileSpec {
  type?: 'VIDEO' | 'PHOTO' | 'DOCUMENT' | 'AUDIO';
  status?: 'PENDING' | 'DOWNLOADED' | 'FAILED';
  fileName?: string | null;
  thumbnail?: boolean;
}

/**
 * Channels, messages and files written straight into the database, the way imports store them
 * (a message first, then its file). `prisma` is read on every call: specs create it in beforeAll.
 */
export function archiveRows(prisma: () => PrismaClient) {
  let chatSequence = 0;

  function addChannel(data: Partial<Prisma.ChannelUncheckedCreateInput> = {}): Promise<Channel> {
    chatSequence += 1;
    return prisma().channel.create({
      data: {
        telegramChatId: BigInt(-1_004_000_000_000 - chatSequence),
        title: `Course ${chatSequence}`,
        type: 'SUPERGROUP',
        ...data,
      },
    });
  }

  async function addMessage(
    channel: Channel,
    id: number,
    data: Partial<Prisma.MessageUncheckedCreateInput> = {},
    file?: FileSpec,
  ): Promise<Message> {
    const message = await prisma().message.create({
      data: {
        channelId: channel.id,
        telegramMessageId: id,
        type: file?.type ?? 'TEXT',
        telegramDate: postedAt(id),
        ...(file ? {} : { text: `Message ${id}` }),
        ...data,
      },
    });
    if (file) {
      await prisma().media.create({
        data: {
          messageId: message.id,
          telegramFileId: `${channel.telegramChatId}:${id}:file${id}`,
          telegramFileUniqueId: `file-${channel.id}-${id}`,
          type: file.type ?? 'VIDEO',
          filename: file.fileName === undefined ? `lesson-${id}.mp4` : file.fileName,
          mimeType: 'video/mp4',
          size: BigInt(1_000 * id),
          duration: 60,
          width: 1280,
          height: 720,
          downloadStatus: file.status ?? 'PENDING',
          thumbnailKey: file.thumbnail
            ? `aa/${'0'.repeat(8)}-0000-7000-8000-${String(id).padStart(12, '0')}.jpg`
            : null,
        },
      });
    }
    return message;
  }

  return { addChannel, addMessage };
}
