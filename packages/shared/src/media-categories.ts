import { MediaType, MessageType } from './enums.js';

/** Sidebar media sections and the media types each one lists. */
export const MEDIA_CATEGORIES = {
  videos: [MediaType.VIDEO, MediaType.ANIMATION, MediaType.VIDEO_NOTE],
  images: [MediaType.PHOTO, MediaType.STICKER],
  documents: [MediaType.DOCUMENT],
  audio: [MediaType.AUDIO, MediaType.VOICE],
} as const satisfies Record<string, readonly MediaType[]>;

export type MediaCategory = keyof typeof MEDIA_CATEGORIES;

export function mediaCategoryOf(type: MediaType): MediaCategory {
  for (const [category, types] of Object.entries(MEDIA_CATEGORIES) as [
    MediaCategory,
    readonly MediaType[],
  ][]) {
    if (types.includes(type)) {
      return category;
    }
  }
  // Every MediaType belongs to a category; this is unreachable unless the enum grows.
  throw new Error(`Unmapped media type: ${type}`);
}

/** Messages without a file: plain text, link previews, polls, locations and the like. */
export const TEXT_MESSAGE_TYPES = [
  MessageType.TEXT,
  MessageType.WEBPAGE,
  MessageType.POLL,
  MessageType.OTHER,
] as const satisfies readonly MessageType[];

/** How lists group messages: text, or one of the media sections. Service messages have none. */
export type MessageCategory = MediaCategory | 'text';

export const MESSAGE_CATEGORIES: readonly MessageCategory[] = [
  'text',
  'videos',
  'images',
  'documents',
  'audio',
];

/** The message types of a category (the type of a message with a file is its file's type). */
export function messageTypesOf(category: MessageCategory): readonly MessageType[] {
  return category === 'text' ? TEXT_MESSAGE_TYPES : MEDIA_CATEGORIES[category];
}

/** The category of a message type; null for service messages (joins, new topics, pins…). */
export function messageCategoryOf(type: MessageType): MessageCategory | null {
  if (type === MessageType.SERVICE) {
    return null;
  }
  if ((TEXT_MESSAGE_TYPES as readonly MessageType[]).includes(type)) {
    return 'text';
  }
  // What is left are exactly the media types.
  return mediaCategoryOf(type as MediaType);
}
