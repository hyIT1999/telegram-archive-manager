import type {
  MediaSummaryDto,
  MessageCategory,
  MessageSummaryDto,
  MessageType,
} from '../../shared/models';

/** Topic id of a forum's General topic (mirrors GENERAL_TOPIC_ID in @tam/shared). */
export const GENERAL_TOPIC_ID = 1;

/**
 * Message types of each list category. Mirrors messageTypesOf() in @tam/shared, which the web
 * does not import at runtime (it keeps @tam/shared type-only).
 */
export const CATEGORY_TYPES: Readonly<Record<MessageCategory, readonly MessageType[]>> = {
  text: ['TEXT', 'WEBPAGE', 'POLL', 'OTHER'],
  videos: ['VIDEO', 'ANIMATION', 'VIDEO_NOTE'],
  images: ['PHOTO', 'STICKER'],
  documents: ['DOCUMENT'],
  audio: ['AUDIO', 'VOICE'],
};

/** Every type that carries a file. */
export const MEDIA_MESSAGE_TYPES: readonly MessageType[] = [
  ...CATEGORY_TYPES.videos,
  ...CATEGORY_TYPES.images,
  ...CATEGORY_TYPES.documents,
  ...CATEGORY_TYPES.audio,
];

export const CATEGORY_OPTIONS: readonly {
  category: MessageCategory;
  label: string;
  icon: string;
}[] = [
  { category: 'text', label: 'Text', icon: 'notes' },
  { category: 'videos', label: 'Videos', icon: 'movie' },
  { category: 'images', label: 'Images', icon: 'photo_library' },
  { category: 'documents', label: 'Documents', icon: 'description' },
  { category: 'audio', label: 'Audio', icon: 'headphones' },
];

/** The category of a message type; null for service messages. */
export function categoryOfType(type: MessageType): MessageCategory | null {
  for (const [category, types] of Object.entries(CATEGORY_TYPES) as [
    MessageCategory,
    readonly MessageType[],
  ][]) {
    if (types.includes(type)) {
      return category;
    }
  }
  return null;
}

const TYPE_LABELS: Readonly<Record<MessageType, string>> = {
  TEXT: 'Text',
  PHOTO: 'Photo',
  VIDEO: 'Video',
  DOCUMENT: 'Document',
  AUDIO: 'Audio',
  VOICE: 'Voice message',
  ANIMATION: 'GIF',
  VIDEO_NOTE: 'Round video',
  STICKER: 'Sticker',
  POLL: 'Poll',
  WEBPAGE: 'Link',
  SERVICE: 'Service message',
  OTHER: 'Message',
};

const TYPE_ICONS: Readonly<Record<MessageType, string>> = {
  TEXT: 'notes',
  PHOTO: 'image',
  VIDEO: 'movie',
  DOCUMENT: 'description',
  AUDIO: 'music_note',
  VOICE: 'mic',
  ANIMATION: 'gif_box',
  VIDEO_NOTE: 'radio_button_checked',
  STICKER: 'sticky_note_2',
  POLL: 'ballot',
  WEBPAGE: 'link',
  SERVICE: 'info',
  OTHER: 'chat',
};

export function typeLabel(type: MessageType): string {
  return TYPE_LABELS[type];
}

export function typeIcon(type: MessageType): string {
  return TYPE_ICONS[type];
}

/** What people call a message: its file name, the first line of its text, or "Video #42". */
export function messageTitle(
  message: Pick<MessageSummaryDto, 'type' | 'telegramMessageId' | 'excerpt'> & {
    media: Pick<MediaSummaryDto, 'fileName'> | null;
  },
): string {
  const fileName = message.media?.fileName?.trim();
  if (fileName) {
    return fileName;
  }
  const firstLine = message.excerpt
    ?.split('\n')
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine) {
    return firstLine.length > 120 ? `${firstLine.slice(0, 119)}…` : firstLine;
  }
  return `${TYPE_LABELS[message.type]} #${message.telegramMessageId}`;
}

const SERVICE_ACTIONS: Readonly<Record<string, string>> = {
  messageActionTopicCreate: 'Topic created',
  messageActionTopicEdit: 'Topic changed',
  messageActionPinMessage: 'Message pinned',
  messageActionChatCreate: 'Group created',
  messageActionChannelCreate: 'Channel created',
  messageActionChatEditTitle: 'Title changed',
  messageActionChatEditPhoto: 'Photo changed',
  messageActionChatDeletePhoto: 'Photo removed',
  messageActionChatAddUser: 'Members joined',
  messageActionChatJoinedByLink: 'Joined with an invite link',
  messageActionChatJoinedByRequest: 'Join request accepted',
  messageActionChatDeleteUser: 'A member left',
  messageActionChatMigrateTo: 'Upgraded to a supergroup',
  messageActionChannelMigrateFrom: 'Upgraded from a basic group',
  messageActionGroupCall: 'Video chat',
  messageActionGroupCallScheduled: 'Video chat scheduled',
  messageActionHistoryClear: 'History cleared',
};

/** What a service message records, e.g. "Topic created". */
export function serviceActionLabel(action: string | null): string {
  return (action && SERVICE_ACTIONS[action]) ?? 'Service message';
}

/** Short download state of a file for lists. */
export function mediaStatusLabel(
  media: Pick<MediaSummaryDto, 'downloadStatus' | 'downloadProgress'>,
): string {
  switch (media.downloadStatus) {
    case 'DOWNLOADED':
      return 'Downloaded';
    case 'DOWNLOADING':
      return `Downloading ${media.downloadProgress}%`;
    case 'FAILED':
      return 'Download failed';
    default:
      return 'Not downloaded';
  }
}
