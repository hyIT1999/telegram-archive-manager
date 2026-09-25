/** How many messages of each kind a forum topic holds (service messages are not counted). */
export interface TopicCountsDto {
  messages: number;
  videos: number;
  images: number;
  documents: number;
  audio: number;
}

/** One forum topic of a channel (GET /api/channels/:id/topics). */
export interface ForumTopicDto {
  /** Telegram topic id (1 = General). */
  topicId: number;
  /** "Topic #<id>" until the name is read from Telegram. */
  title: string;
  /** Colour of the topic icon as #rrggbb; null when unknown. */
  iconColor: string | null;
  isClosed: boolean;
  isPinned: boolean;
  /** When the topic was created on Telegram. */
  createdAt: string | null;
  counts: TopicCountsDto;
  /** The oldest and the newest archived message of the topic. */
  firstPostedAt: string | null;
  lastPostedAt: string | null;
}

/** GET /api/channels/:id/topics and POST /api/channels/:id/topics/refresh */
export interface ForumTopicListDto {
  /** Whether the channel is a forum; other chats have no topics. */
  forum: boolean;
  /** When the topic names were last read from Telegram; null while never. */
  refreshedAt: string | null;
  /** In creation order (topic id), which in course channels follows the lessons. */
  topics: ForumTopicDto[];
}
