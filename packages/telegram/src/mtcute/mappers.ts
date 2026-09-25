import {
  type Chat as MtChat,
  type Message as MtMessage,
  type MessageMedia as MtMessageMedia,
  type User as MtUser,
  getMarkedPeerId,
  type tl,
} from '@mtcute/core';
import { ChatType, MediaType, MessageType } from '@tam/shared';
import { encodeFileId } from '../file-id.js';
import type {
  Chat,
  ForwardInfo,
  Message,
  MessageEntity,
  MessageMedia,
  TelegramUser,
} from '../types.js';

export function mapUser(user: MtUser): TelegramUser {
  return { id: String(user.id), username: user.username, displayName: user.displayName };
}

const CHAT_TYPES: Partial<Record<MtChat['chatType'], ChatType>> = {
  channel: ChatType.CHANNEL,
  supergroup: ChatType.SUPERGROUP,
  gigagroup: ChatType.SUPERGROUP,
  group: ChatType.GROUP,
};

/**
 * Maps a dialog chat to the domain Chat. Returns null for chats that cannot be archived:
 * inaccessible ones (left, banned), basic groups that were upgraded, monoforums and communities.
 */
export function mapChat(chat: MtChat): Chat | null {
  const type = CHAT_TYPES[chat.chatType];
  const raw = chat.raw;
  if (!type || (raw._ !== 'channel' && raw._ !== 'chat') || (raw._ === 'chat' && raw.deactivated)) {
    return null;
  }
  return {
    id: String(chat.id),
    title: chat.title,
    username: raw._ === 'channel' ? usernameOf(raw) : null,
    type,
    accessHash: raw._ === 'channel' && raw.accessHash ? raw.accessHash.toString() : null,
    isForum: chat.isForum,
    isProtected: chat.hasContentProtection,
    memberCount: chat.membersCount,
    // Only available from the full chat; resolved when an import starts.
    migratedFromChatId: null,
  };
}

/**
 * mtcute's `Chat.username` getter indexes `usernames[0]` and throws on an empty list, so the
 * active public username is read from the raw channel instead.
 */
function usernameOf(raw: tl.RawChannel): string | null {
  return raw.username ?? raw.usernames?.find((entry) => entry.active)?.username ?? null;
}

/**
 * File sizes are int64 in TL. mtcute reads them as numbers; a Long or bigint is normalized too, so
 * a change in the reader can never put an object into the database.
 */
/** File sizes arrive as numbers or as Long (int64) objects, depending on the TL type. */
export function sizeOf(value: unknown): number | null {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (value !== null && typeof value === 'object' && 'toNumber' in value) {
    return (value as { toNumber(): number }).toNumber();
  }
  return null;
}

export function messageTypeOf(message: MtMessage): MessageType {
  if (message.isService) {
    return MessageType.SERVICE;
  }
  const media = message.media;
  switch (media?.type) {
    case undefined:
      return MessageType.TEXT;
    case 'photo':
      return MessageType.PHOTO;
    case 'video':
      if (media.isRound) return MessageType.VIDEO_NOTE;
      return media.isAnimation ? MessageType.ANIMATION : MessageType.VIDEO;
    case 'document':
      return MessageType.DOCUMENT;
    case 'audio':
      return MessageType.AUDIO;
    case 'voice':
      return MessageType.VOICE;
    case 'sticker':
      return MessageType.STICKER;
    case 'poll':
      return MessageType.POLL;
    case 'webpage':
      return MessageType.WEBPAGE;
    default:
      return MessageType.OTHER;
  }
}

/**
 * The downloadable file attached to a message (at most one per message; albums are separate
 * messages). Link previews, polls, locations and the like carry nothing to archive.
 */
export function mapMedia(media: MtMessageMedia, chatId: string, messageId: string): MessageMedia[] {
  if (!media) {
    return [];
  }
  const base = (type: MediaType, fileUniqueId: string) => ({
    fileId: encodeFileId({ chatId, messageId, fileUniqueId }),
    fileUniqueId,
    type,
  });
  switch (media.type) {
    case 'photo':
      return [
        {
          ...base(MediaType.PHOTO, media.uniqueFileId),
          fileName: null,
          mimeType: 'image/jpeg',
          size: sizeOf(media.fileSize),
          width: media.width,
          height: media.height,
          duration: null,
          hasThumbnail: media.thumbnails.length > 0,
          isSelfDestructing: media.ttlSeconds !== null,
        },
      ];
    case 'video':
      return [
        {
          ...base(
            media.isRound ? MediaType.VIDEO_NOTE : media.isAnimation ? MediaType.ANIMATION : MediaType.VIDEO,
            media.uniqueFileId,
          ),
          fileName: media.fileName,
          mimeType: media.mimeType,
          size: sizeOf(media.fileSize),
          width: media.width,
          height: media.height,
          duration: media.duration,
          hasThumbnail: media.thumbnails.length > 0,
          isSelfDestructing: media.ttlSeconds !== null,
        },
      ];
    case 'document':
    case 'audio':
    case 'voice':
    case 'sticker': {
      const type = {
        document: MediaType.DOCUMENT,
        audio: MediaType.AUDIO,
        voice: MediaType.VOICE,
        sticker: MediaType.STICKER,
      }[media.type];
      return [
        {
          ...base(type, media.uniqueFileId),
          fileName: media.fileName,
          mimeType: media.mimeType,
          size: sizeOf(media.fileSize),
          width: media.type === 'sticker' ? media.width : null,
          height: media.type === 'sticker' ? media.height : null,
          duration: media.type === 'audio' || media.type === 'voice' ? media.duration : null,
          hasThumbnail: media.thumbnails.length > 0,
          isSelfDestructing: media.type === 'voice' && media.ttlSeconds !== null,
        },
      ];
    }
    default:
      return [];
  }
}

export function mapMessage(message: MtMessage, chatId: string): Message {
  const raw = message.raw;
  const id = String(message.id);
  const media = message.isService ? [] : mapMedia(message.media, chatId, id);
  const text = message.text.length > 0 ? message.text : null;
  const hasAttachment = media.length > 0;
  const reply = raw.replyTo?._ === 'messageReplyHeader' ? raw.replyTo : null;

  return {
    id,
    chatId,
    date: message.date,
    editDate: message.editDate,
    type: messageTypeOf(message),
    // MTProto keeps one text field; with an attachment it is the caption.
    text: hasAttachment ? null : text,
    caption: hasAttachment ? text : null,
    entities: raw._ === 'message' && raw.entities?.length ? raw.entities.map(mapEntity) : null,
    // Replies to another chat (replyToPeerId) do not point into this archive.
    replyToMessageId:
      reply?.replyToMsgId !== undefined && !reply.replyToPeerId ? String(reply.replyToMsgId) : null,
    threadId: reply?.forumTopic ? String(reply.replyToTopId ?? reply.replyToMsgId) : null,
    mediaGroupId: message.groupedId ? message.groupedId.toString() : null,
    forward: raw._ === 'message' && raw.fwdFrom ? mapForward(raw.fwdFrom) : null,
    views: message.views,
    isService: message.isService,
    isContentProtected: message.isContentProtected,
    ttlPeriod: message.ttlPeriod,
    media,
    meta: messageMeta(message),
  };
}

function messageMeta(message: MtMessage): Record<string, unknown> {
  const raw = message.raw;
  const meta: Record<string, unknown> = {};
  if (raw.fromId) {
    meta['senderId'] = String(getMarkedPeerId(raw.fromId));
  }
  if (raw._ === 'messageService') {
    meta['action'] = raw.action._;
    return meta;
  }
  if (raw.postAuthor) meta['postAuthor'] = raw.postAuthor;
  if (raw.forwards !== undefined) meta['forwards'] = raw.forwards;
  if (raw.pinned) meta['pinned'] = true;
  const media = message.media;
  if (media?.type === 'webpage') {
    meta['webpageUrl'] = media.preview.url;
  }
  return meta;
}

function mapForward(header: tl.RawMessageFwdHeader): ForwardInfo {
  return {
    date: new Date(header.date * 1000),
    fromChatId: header.fromId ? String(getMarkedPeerId(header.fromId)) : null,
    fromMessageId: header.channelPost !== undefined ? String(header.channelPost) : null,
    senderName: header.fromName ?? header.postAuthor ?? null,
  };
}

function mapEntity(entity: tl.TypeMessageEntity): MessageEntity {
  const { _: name, offset, length, ...rest } = entity;
  const bare = name.replace(/^(input)?[mM]essageEntity/, '');
  const kind = bare.charAt(0).toLowerCase() + bare.slice(1);
  const params = toJsonSafe(rest) as Record<string, unknown>;
  return Object.keys(params).length > 0 ? { kind, offset, length, params } : { kind, offset, length };
}

/** Longs, bigints and bytes become strings so entities can be stored as JSON. */
function toJsonSafe(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array) return Buffer.from(value).toString('base64');
  if (Array.isArray(value)) return value.map(toJsonSafe);
  if (typeof value === 'object') {
    if (isLong(value)) return value.toString();
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, toJsonSafe(inner)]));
  }
  return value;
}

function isLong(value: object): value is { toString(): string } {
  return 'low' in value && 'high' in value && 'unsigned' in value;
}
