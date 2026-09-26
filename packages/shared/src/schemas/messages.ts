import { z } from 'zod';
import { MessageType } from '../enums.js';
import { type Page, csvList, cursorQuerySchema, isoDateOrDateTimeSchema } from './common.js';
import type { MediaDto, MediaSummaryDto } from './media.js';
import type { TagRefDto } from './tags.js';

/** `favorited`: most recently favorited first (favorites only). */
export const messageSortSchema = z.enum(['newest', 'oldest', 'favorited']);
export type MessageSort = z.infer<typeof messageSortSchema>;

/** Tags one filter may combine. */
export const MAX_FILTER_TAGS = 10;

/** Topic id of a forum's General topic: its messages carry no thread id. */
export const GENERAL_TOPIC_ID = 1;

/** Characters of text or caption a list item carries. */
export const MESSAGE_EXCERPT_LENGTH = 500;

const DAY_MS = 86_400_000;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The first instant a `from` filter includes; a bare date starts at 00:00 UTC. */
export function rangeStart(value: string): Date {
  return new Date(DATE_ONLY.test(value) ? `${value}T00:00:00.000Z` : value);
}

/** The last instant a `to` filter includes; a bare date ends at 23:59:59.999 UTC. */
export function rangeEnd(value: string): Date {
  return DATE_ONLY.test(value)
    ? new Date(Date.parse(`${value}T00:00:00.000Z`) + DAY_MS - 1)
    : new Date(value);
}

/** The filters of GET /api/messages and GET /api/search. */
export const messageFilterShape = {
  /** Messages of this channel and of the old basic group it was upgraded from. */
  channelId: z.uuid().optional(),
  /** Messages of one forum topic of that channel (1 = General). */
  topicId: z.coerce.number().int().min(1).max(2_147_483_647).optional(),
  /** Message types; without it, every type but SERVICE. */
  types: csvList(z.enum(MessageType)).optional(),
  from: isoDateOrDateTimeSchema.optional(),
  to: isoDateOrDateTimeSchema.optional(),
  /** true: only messages whose file is downloaded; false: only files not downloaded yet. */
  downloaded: z.stringbool().optional(),
  /** Messages carrying every one of these tags. */
  tagIds: csvList(z.uuid())
    .refine((ids) => ids.length <= MAX_FILTER_TAGS, `At most ${MAX_FILTER_TAGS} tags`)
    .optional(),
  /** true: only favorites; false: only messages that are not. */
  favorite: z.stringbool().optional(),
};

/** What the filters parse to (both queries carry them). */
export interface MessageFilters {
  channelId?: string;
  topicId?: number;
  types?: MessageType[];
  from?: string;
  to?: string;
  downloaded?: boolean;
  tagIds?: string[];
  favorite?: boolean;
}

/** Checks that the filters make sense together: a topic needs its channel, dates run forward. */
export function withFilterRules<T extends z.ZodType<MessageFilters>>(schema: T): T {
  return schema
    .refine((query) => query.topicId === undefined || query.channelId !== undefined, {
      message: 'A topic needs its channel (channelId)',
      path: ['topicId'],
    })
    .refine(
      (query) =>
        query.from === undefined ||
        query.to === undefined ||
        rangeStart(query.from).getTime() <= rangeEnd(query.to).getTime(),
      { message: '"from" must not be after "to"', path: ['from'] },
    );
}

/** GET /api/messages */
export const messageListQuerySchema = withFilterRules(
  cursorQuerySchema.extend({
    ...messageFilterShape,
    sort: messageSortSchema.default('newest'),
  }),
).refine((query) => query.sort !== 'favorited' || query.favorite === true, {
  message: 'Sorting by favorite date lists favorites only (favorite=true)',
  path: ['sort'],
});
export type MessageListQuery = z.infer<typeof messageListQuerySchema>;

/** Where a search matched in a string: [offset, length] in UTF-16 code units, like JavaScript. */
export type TextRange = readonly [offset: number, length: number];

/** Search results only: what matched in the file name and in the excerpt. */
export interface MessageMatchesDto {
  fileName: TextRange[];
  excerpt: TextRange[];
}

/** The channel of a message, as lists show it. */
export interface MessageChannelRefDto {
  id: string;
  title: string;
}

/** The forum topic of a message. */
export interface MessageTopicRefDto {
  /** Telegram topic id (1 = General). */
  id: number;
  /** "Topic #<id>" until the topic's name is read from Telegram. */
  title: string;
}

/** GET /api/messages — one message as lists show it. */
export interface MessageSummaryDto {
  id: string;
  channel: MessageChannelRefDto;
  telegramMessageId: number;
  type: MessageType;
  /** When the message was posted on Telegram. */
  postedAt: string;
  /** The start of the text or caption (at most MESSAGE_EXCERPT_LENGTH characters). */
  excerpt: string | null;
  /** Album id: the messages sent together as one album share it. */
  mediaGroupId: string | null;
  /** Only for messages of forums. */
  topic: MessageTopicRefDto | null;
  /** The message's file, if it has one. */
  media: MediaSummaryDto | null;
  isFavorite: boolean;
  /** By name. */
  tags: TagRefDto[];
  /** GET /api/search only: where the search words were found. */
  matches?: MessageMatchesDto;
}

export interface MessagePageDto extends Page<MessageSummaryDto> {
  /** How many messages match; only on the first page (requested without a cursor). */
  total: number | null;
}

/** Formatting the web renders. Anything else Telegram sends (custom emoji, user ids…) is left out. */
export const MESSAGE_ENTITY_KINDS = [
  'bold',
  'italic',
  'underline',
  'strike',
  'spoiler',
  'code',
  'pre',
  'blockquote',
  /** The text itself is a web address. */
  'link',
  /** A text that links somewhere else (`url`). */
  'textLink',
  'mention',
  'hashtag',
  'cashtag',
  'email',
  'phone',
  'botCommand',
] as const;
export type MessageEntityKind = (typeof MESSAGE_ENTITY_KINDS)[number];

/** One formatting range; offset and length count UTF-16 code units, like JavaScript strings. */
export interface MessageEntityDto {
  kind: MessageEntityKind;
  offset: number;
  length: number;
  /** textLink only: the target, always http(s), tg or mailto. */
  url?: string;
  /** pre only: the language of the code block. */
  language?: string;
}

/** Where a forwarded message came from. */
export interface MessageForwardDto {
  /** When the original message was sent. */
  date: string;
  /** Marked id of the chat or user it came from, when Telegram tells. */
  fromChatId: string | null;
  /** Its id there (channel posts). */
  fromMessageId: number | null;
  /** The name shown for a sender who hides their account, or the post signature. */
  senderName: string | null;
}

/** The message a reply answers. */
export interface MessageReplyDto {
  telegramMessageId: number;
  /** The archived message; null when it is not in the archive. */
  messageId: string | null;
  excerpt: string | null;
}

/** GET /api/messages/:id */
export interface MessageDto extends MessageSummaryDto {
  /** Text of a message without a file. */
  text: string | null;
  /** Text sent with a file. */
  caption: string | null;
  /** Formatting of the text or caption. */
  entities: MessageEntityDto[];
  editedAt: string | null;
  views: number | null;
  forwards: number | null;
  /** Signature of a channel post. */
  postAuthor: string | null;
  pinned: boolean;
  /** Telegram's name of what a service message records, e.g. messageActionTopicCreate. */
  serviceAction: string | null;
  forward: MessageForwardDto | null;
  /** A real reply. Messages of a forum topic merely point at the topic and have none. */
  replyTo: MessageReplyDto | null;
  /** Every message of the album, this one included, oldest first; empty outside albums. */
  album: MessageSummaryDto[];
  media: MediaDto | null;
  /** The older and the newer message of the same channel, topic and category. */
  previousId: string | null;
  nextId: string | null;
  /** The message in Telegram, for people who can read the chat. */
  telegramUrl: string | null;
  /** When it became a favorite. */
  favoritedAt: string | null;
}

/** POST and DELETE /api/messages/:id/favorite */
export interface FavoriteDto {
  isFavorite: boolean;
  favoritedAt: string | null;
}
