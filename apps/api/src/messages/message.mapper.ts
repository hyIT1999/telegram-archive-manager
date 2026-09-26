import type { Channel, Media, Message } from '@tam/database';
import {
  GENERAL_TOPIC_ID,
  MESSAGE_EXCERPT_LENGTH,
  type MessageEntityDto,
  type MessageEntityKind,
  type MessageForwardDto,
  type MessageSummaryDto,
  type MessageTopicRefDto,
} from '@tam/shared';
import { toMediaSummaryDto } from '../media/media.mapper.js';
import { MESSAGE_TAGS_INCLUDE, type TagRef, toTagRefDto } from '../tags/tag.mapper.js';

/** What list queries load next to each message. A message has at most one file. */
export const MESSAGE_SUMMARY_INCLUDE = {
  channel: { select: { id: true, title: true, isForum: true } },
  media: { orderBy: { createdAt: 'asc' }, take: 1 },
  tags: MESSAGE_TAGS_INCLUDE,
} as const;

export type MessageSummaryRow = Message & {
  channel: Pick<Channel, 'id' | 'title' | 'isForum'>;
  media: Media[];
  tags: { tag: TagRef }[];
};

/** Names of forum topics, by topicKey(). */
export type TopicTitles = ReadonlyMap<string, string>;

export function topicKey(channelId: string, topicId: number): string {
  return `${channelId}:${topicId}`;
}

/** The topic a message of a forum belongs to; messages without a thread are in General. */
export function topicIdOf(message: Pick<Message, 'threadId'>): number {
  return message.threadId ?? GENERAL_TOPIC_ID;
}

export function topicTitle(topicId: number, known: string | undefined): string {
  return known ?? (topicId === GENERAL_TOPIC_ID ? 'General' : `Topic #${topicId}`);
}

function topicRef(row: MessageSummaryRow, titles: TopicTitles): MessageTopicRefDto | null {
  if (!row.channel.isForum) {
    return null;
  }
  const id = topicIdOf(row);
  return { id, title: topicTitle(id, titles.get(topicKey(row.channel.id, id))) };
}

/** At most `length` UTF-16 units of the start of a text, never cutting a character in two. */
export function cutText(text: string, length: number): string {
  if (text.length <= length) {
    return text;
  }
  const start = text.slice(0, length);
  return /[\uD800-\uDBFF]$/.test(start) ? start.slice(0, -1) : start;
}

/** The start of a text for lists. */
export function excerptOf(text: string | null): string | null {
  return text === null || text.length === 0 ? null : cutText(text, MESSAGE_EXCERPT_LENGTH);
}

export function toMessageSummaryDto(
  row: MessageSummaryRow,
  titles: TopicTitles,
): MessageSummaryDto {
  const file = row.media[0];
  return {
    id: row.id,
    channel: { id: row.channel.id, title: row.channel.title },
    telegramMessageId: row.telegramMessageId,
    type: row.type,
    postedAt: row.telegramDate.toISOString(),
    excerpt: excerptOf(row.text ?? row.caption),
    mediaGroupId: row.mediaGroupId === null ? null : row.mediaGroupId.toString(),
    topic: topicRef(row, titles),
    media: file ? toMediaSummaryDto(file) : null,
    isFavorite: row.isFavorite,
    tags: row.tags.map(({ tag }) => toTagRefDto(tag)),
  };
}

/** Telegram's entity names (see @tam/telegram mappers) → what the web renders. */
const ENTITY_KINDS: Readonly<Record<string, MessageEntityKind>> = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'strike',
  spoiler: 'spoiler',
  code: 'code',
  pre: 'pre',
  blockquote: 'blockquote',
  url: 'link',
  textUrl: 'textLink',
  mention: 'mention',
  hashtag: 'hashtag',
  cashtag: 'cashtag',
  email: 'email',
  phone: 'phone',
  botCommand: 'botCommand',
};

/** Links the web may open: never javascript:, data: or the like. */
const SAFE_LINK = /^(https?:\/\/|tg:\/\/|mailto:)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The formatting the web renders, checked against the text: unknown kinds (custom emoji, user
 * mentions by id…), ranges outside the text and unsafe link targets are left out.
 */
export function toEntityDtos(stored: unknown, text: string | null): MessageEntityDto[] {
  if (!Array.isArray(stored) || text === null) {
    return [];
  }
  const entities: MessageEntityDto[] = [];
  for (const item of stored) {
    if (!isRecord(item)) {
      continue;
    }
    const kind = typeof item['kind'] === 'string' ? ENTITY_KINDS[item['kind']] : undefined;
    const offset = item['offset'];
    const length = item['length'];
    if (
      kind === undefined ||
      typeof offset !== 'number' ||
      typeof length !== 'number' ||
      !Number.isInteger(offset) ||
      !Number.isInteger(length) ||
      offset < 0 ||
      length <= 0 ||
      offset + length > text.length
    ) {
      continue;
    }
    const params = isRecord(item['params']) ? item['params'] : {};
    const entity: MessageEntityDto = { kind, offset, length };
    if (kind === 'textLink') {
      const url = typeof params['url'] === 'string' ? params['url'].trim() : '';
      if (!SAFE_LINK.test(url)) {
        continue;
      }
      entity.url = url;
    }
    if (kind === 'pre' && typeof params['language'] === 'string' && params['language'] !== '') {
      entity.language = params['language'].slice(0, 32);
    }
    entities.push(entity);
  }
  // Outer ranges first, so renderers can nest.
  return entities.sort((a, b) => a.offset - b.offset || b.length - a.length);
}

/** Where a forwarded message came from (stored as JSON by the importer). */
export function toForwardDto(stored: unknown): MessageForwardDto | null {
  if (!isRecord(stored) || typeof stored['date'] !== 'string') {
    return null;
  }
  const fromMessageId = Number(stored['fromMessageId']);
  return {
    date: stored['date'],
    fromChatId: typeof stored['fromChatId'] === 'string' ? stored['fromChatId'] : null,
    fromMessageId:
      stored['fromMessageId'] !== null && Number.isSafeInteger(fromMessageId) && fromMessageId > 0
        ? fromMessageId
        : null,
    senderName: typeof stored['senderName'] === 'string' ? stored['senderName'] : null,
  };
}

/** The original-message details the importer kept (post author, forwards, pinned, action). */
export interface MessageMeta {
  postAuthor: string | null;
  forwards: number | null;
  pinned: boolean;
  serviceAction: string | null;
}

export function toMessageMeta(stored: unknown): MessageMeta {
  const meta = isRecord(stored) ? stored : {};
  return {
    postAuthor: typeof meta['postAuthor'] === 'string' ? meta['postAuthor'] : null,
    forwards: typeof meta['forwards'] === 'number' ? meta['forwards'] : null,
    pinned: meta['pinned'] === true,
    serviceAction: typeof meta['action'] === 'string' ? meta['action'] : null,
  };
}
