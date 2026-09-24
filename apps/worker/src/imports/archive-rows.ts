import { Prisma } from '@tam/database';
import type { Message, MessageMedia } from '@tam/telegram';

/**
 * Messages the archive never keeps (Telegram API Terms): content-protected messages and messages
 * with an auto-delete timer. They still count as read, so progress reaches the total.
 */
export function isArchivable(message: Message): boolean {
  return !message.isContentProtected && message.ttlPeriod === null;
}

/** View-once and timed media are never stored, even when the message itself is. */
export function isArchivableMedia(media: MessageMedia): boolean {
  return !media.isSelfDestructing;
}

/** PostgreSQL text and jsonb cannot hold U+0000, which Telegram messages occasionally carry. */
// eslint-disable-next-line no-control-regex
const NUL = /\u0000/g;

function cleanText(value: string | null): string | null {
  return value === null ? null : value.replace(NUL, '');
}

function cleanJson(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(NUL, '');
  }
  if (Array.isArray(value)) {
    return value.map(cleanJson);
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [key.replace(NUL, ''), cleanJson(inner)]),
    );
  }
  return value;
}

type JsonColumn = Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue;

function json(value: unknown): JsonColumn {
  return value === null || value === undefined
    ? Prisma.DbNull
    : (cleanJson(value) as Prisma.InputJsonValue);
}

function optionalInt(value: string | null): number | null {
  return value === null ? null : Number(value);
}

/** The columns an edit can change (text, formatting, views, metadata). */
export function editableColumns(message: Message) {
  return {
    type: message.type,
    text: cleanText(message.text),
    caption: cleanText(message.caption),
    entities: json(message.entities),
    editDate: message.editDate,
    views: message.views,
    telegramMeta: json(Object.keys(message.meta).length > 0 ? message.meta : null),
  };
}

export function toMessageRow(channelId: string, message: Message): Prisma.MessageCreateManyInput {
  return {
    channelId,
    telegramMessageId: Number(message.id),
    telegramDate: message.date,
    replyToMessageId: optionalInt(message.replyToMessageId),
    mediaGroupId: message.mediaGroupId === null ? null : BigInt(message.mediaGroupId),
    threadId: optionalInt(message.threadId),
    forwardInfo: json(
      message.forward && {
        date: message.forward.date.toISOString(),
        fromChatId: message.forward.fromChatId,
        fromMessageId: message.forward.fromMessageId,
        senderName: message.forward.senderName,
      },
    ),
    ...editableColumns(message),
  };
}

export function toMediaRow(messageId: string, media: MessageMedia): Prisma.MediaCreateManyInput {
  return {
    messageId,
    telegramFileId: media.fileId,
    telegramFileUniqueId: media.fileUniqueId,
    type: media.type,
    filename: cleanText(media.fileName),
    mimeType: media.mimeType,
    size: media.size === null ? null : BigInt(Math.trunc(media.size)),
    width: media.width,
    height: media.height,
    duration: media.duration,
  };
}

/** True when Telegram has a newer edit of a message than the archive. */
export function isNewerEdit(incoming: Date | null, stored: Date | null): boolean {
  return incoming !== null && (stored === null || incoming.getTime() > stored.getTime());
}
