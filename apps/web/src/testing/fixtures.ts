import type { TestRequest } from '@angular/common/http/testing';
import type {
  ApiErrorBody,
  AuthUserDto,
  ChannelBackupDto,
  ChannelDownloadsDto,
  ChannelDto,
  ForumTopicDto,
  ForumTopicListDto,
  ImportJobDto,
  MediaDto,
  MediaSummaryDto,
  MessageBackupDto,
  MessageDto,
  MessagePageDto,
  MessageSummaryDto,
  Page,
  SessionDto,
  SettingsDto,
  StatsDto,
  StorageCheckDto,
  StorageLocationDto,
  StorageLocationListDto,
  TagDto,
  TagListDto,
  TagRefDto,
  TelegramDialogDto,
  TelegramDialogListDto,
  TelegramStatusDto,
} from '@tam/shared';

// Test data builders and HTTP helpers. Only specs import this folder; the app build excludes it.

const STATUS_TEXT: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

export function makeUser(overrides: Partial<AuthUserDto> = {}): AuthUserDto {
  return {
    id: '0199a0b1-0000-7000-8000-000000000001',
    email: 'archivist@example.test',
    lastLoginAt: '2026-09-20T08:00:00.000Z',
    ...overrides,
  };
}

/** A signed-in browser of the current user (this one unless `current: false`). */
export function makeSession(overrides: Partial<SessionDto> = {}): SessionDto {
  return {
    id: '0199a0b1-0000-7000-8000-00000000a001',
    current: true,
    createdAt: '2026-09-20T08:00:00.000Z',
    lastSeenAt: '2026-09-20T09:00:00.000Z',
    expiresAt: '2026-09-27T09:00:00.000Z',
    ip: '127.0.0.1',
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36',
    ...overrides,
  };
}

export function makeStats(overrides: Partial<StatsDto> = {}): StatsDto {
  return {
    channels: 3,
    messages: 12_345,
    videos: 210,
    images: 1_830,
    documents: 96,
    audio: 41,
    storageBytes: 5 * 1024 ** 3,
    downloaded: 2_100,
    pending: 70,
    failed: 7,
    ...overrides,
  };
}

let channelSequence = 0;

export function makeChannel(overrides: Partial<ChannelDto> = {}): ChannelDto {
  channelSequence += 1;
  const suffix = String(channelSequence).padStart(12, '0');
  return {
    id: `0199a0b1-0000-7000-8000-${suffix}`,
    telegramChatId: `-100${1_000_000_000 + channelSequence}`,
    title: `Physics Notes ${channelSequence}`,
    username: `physics_notes_${channelSequence}`,
    type: 'CHANNEL',
    isProtected: false,
    isForum: false,
    memberCount: 1_520,
    syncEnabled: true,
    syncNote: null,
    headMessageId: 4_812,
    backfillComplete: true,
    lastSyncedAt: '2026-09-23T21:15:00.000Z',
    migratedToChannelId: null,
    storageLocation: null,
    storageFolder: null,
    downloadMedia: true,
    downloadNote: null,
    backupLocation: null,
    backupEnabled: false,
    backupNote: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-23T21:15:00.000Z',
    stats: { messages: 4_812, media: 640, downloadedMedia: 600, storageBytes: 3 * 1024 ** 3 },
    ...overrides,
  };
}

export function makePage<T>(items: T[], nextCursor: string | null = null): Page<T> {
  return { items, nextCursor };
}

let jobSequence = 0;

/** A running import of the whole history, 120 of about 500 messages read. */
export function makeImportJob(overrides: Partial<ImportJobDto> = {}): ImportJobDto {
  jobSequence += 1;
  const channelId =
    overrides.channelId ?? `0199a0b1-0000-7000-8000-c${String(jobSequence).padStart(11, '0')}`;
  return {
    id: `0199a0b1-0000-7000-8000-a${String(jobSequence).padStart(11, '0')}`,
    channelId,
    channel: {
      id: channelId,
      telegramChatId: `-100${3_000_000_000 + jobSequence}`,
      title: `Lessons ${jobSequence}`,
      username: `lessons_${jobSequence}`,
      type: 'CHANNEL',
    },
    parentImportJobId: null,
    type: 'IMPORT',
    origin: 'MANUAL',
    mode: 'ALL',
    fromDate: null,
    status: 'RUNNING',
    phase: 'HISTORY',
    totalMessages: 500,
    processedMessages: 120,
    totalMedia: 12,
    downloadedFiles: 0,
    failedFiles: 0,
    skippedFiles: 0,
    totalBytes: 48 * 1024 ** 2,
    downloadedBytes: 0,
    activeFiles: [],
    statusDetail: null,
    error: null,
    startedAt: '2026-09-24T09:00:05.000Z',
    messagesCompletedAt: null,
    completedAt: null,
    createdAt: '2026-09-24T09:00:00.000Z',
    updatedAt: '2026-09-24T09:01:00.000Z',
    ...overrides,
  };
}

let locationSequence = 0;

export function makeStorageLocation(
  overrides: Partial<StorageLocationDto> = {},
): StorageLocationDto {
  locationSequence += 1;
  return {
    id: `0199a0b1-0000-7000-8000-5${String(locationSequence).padStart(11, '0')}`,
    kind: 'LOCAL',
    name: `Archive ${locationSequence}`,
    displayPath: `D:\\Archive\\Folder ${locationSequence}`,
    accountEmail: null,
    telegram: null,
    isDefault: false,
    builtIn: false,
    lastError: null,
    lastCheckedAt: '2026-09-24T08:00:00.000Z',
    unavailableUntil: null,
    channelCount: 0,
    createdAt: '2026-09-24T08:00:00.000Z',
    ...overrides,
  };
}

/** Downloads of a channel: some done, one running, room to spare in its location. */
export function makeChannelDownloads(
  overrides: Partial<ChannelDownloadsDto> = {},
): ChannelDownloadsDto {
  return {
    channelId: '0199a0b1-0000-7000-8000-000000000001',
    downloadMedia: true,
    downloadNote: null,
    paused: false,
    files: { pending: 5, active: 1, downloaded: 4, failed: 0, skipped: 0, cancelled: 0 },
    bytes: { total: 10 * 1024 ** 3, downloaded: 4 * 1024 ** 3, remaining: 6 * 1024 ** 3 },
    active: [],
    location: {
      id: '0199a0b1-0000-7000-8000-500000000001',
      kind: 'LOCAL',
      name: 'This computer',
      displayPath: 'D:\\Archive',
      freeBytes: 120 * 1024 ** 3,
      unavailableUntil: null,
      lastError: null,
    },
    fits: true,
    ...overrides,
  };
}

/** A backup chat: a private supergroup with topics, where the account may post. */
export function makeTelegramLocation(
  overrides: Partial<StorageLocationDto> = {},
): StorageLocationDto {
  return makeStorageLocation({
    kind: 'TELEGRAM',
    name: 'Backups',
    displayPath: 'Telegram › Backups',
    telegram: {
      telegramChatId: '-1009876543210',
      type: 'SUPERGROUP',
      username: null,
      isForum: true,
    },
    ...overrides,
  });
}

/**
 * The backup of a channel into "Backups": 2 of 10 messages copied, one uploading, nothing
 * verified yet.
 */
export function makeChannelBackup(overrides: Partial<ChannelBackupDto> = {}): ChannelBackupDto {
  return {
    channelId: '0199a0b1-0000-7000-8000-000000000001',
    backupEnabled: true,
    backupNote: null,
    paused: false,
    chat: {
      id: '0199a0b1-0000-7000-8000-5000000000b1',
      name: 'Backups',
      displayPath: 'Telegram › Backups',
      telegramChatId: '-1009876543210',
      isForum: true,
      unavailableUntil: null,
      lastError: null,
    },
    messages: { pending: 7, active: 1, completed: 2, failed: 0, skipped: 0 },
    bytes: { total: 10 * 1024 ** 3, uploaded: 2 * 1024 ** 3, remaining: 8 * 1024 ** 3 },
    active: [],
    failures: [],
    verify: { running: false, verifiedAt: null, ok: 0, problems: 0, problemSamples: [] },
    ...overrides,
  };
}

/** A message's copy in "Backups", sent on 25 September. */
export function makeMessageBackup(overrides: Partial<MessageBackupDto> = {}): MessageBackupDto {
  return {
    chat: {
      id: '0199a0b1-0000-7000-8000-5000000000b1',
      name: 'Backups',
      displayPath: 'Telegram › Backups',
    },
    status: 'COMPLETED',
    stage: null,
    skipReason: null,
    error: null,
    attempts: 1,
    size: 90 * 1024 ** 2,
    uploadedBytes: 90 * 1024 ** 2,
    requested: false,
    url: 'https://t.me/c/9876543210/1001',
    completedAt: '2026-09-25T10:00:00.000Z',
    verifiedAt: null,
    verifyError: null,
    ...overrides,
  };
}

/**
 * The settings as the server starts: download everything, two at a time; check every 15 min;
 * backups not paused.
 */
export function makeSettings(
  overrides: Partial<SettingsDto['downloads']> = {},
  sync: Partial<SettingsDto['sync']> = {},
  backups: Partial<SettingsDto['backups']> = {},
): SettingsDto {
  return {
    downloads: {
      paused: false,
      mediaTypes: [
        'PHOTO',
        'VIDEO',
        'DOCUMENT',
        'AUDIO',
        'VOICE',
        'ANIMATION',
        'VIDEO_NOTE',
        'STICKER',
      ],
      maxFileSizeMb: null,
      concurrency: 2,
      ...overrides,
    },
    sync: { intervalMinutes: 15, ...sync },
    backups: { paused: false, ...backups },
    disk: { minFreeDiskMb: 2048 },
  };
}

/** A successful check: the location could be written, with its free space. */
export function makeStorageCheck(
  location: StorageLocationDto,
  overrides: Partial<StorageCheckDto> = {},
): StorageCheckDto {
  return {
    location,
    ok: true,
    space: { freeBytes: 120 * 1024 ** 3, totalBytes: 500 * 1024 ** 3, usedBytes: 380 * 1024 ** 3 },
    ...overrides,
  };
}

export function makeStorageList(
  items: StorageLocationDto[],
  capabilities: Partial<StorageLocationListDto['capabilities']> = {},
): StorageLocationListDto {
  return {
    items,
    capabilities: {
      localRoots: ['D:\\Archive'],
      googleDrive: { available: true, reason: null },
      telegram: { available: true, reason: null },
      ...capabilities,
    },
  };
}

/** A worker connected to Telegram, with the account logged out. */
export function makeTelegramStatus(overrides: Partial<TelegramStatusDto> = {}): TelegramStatusDto {
  return {
    worker: 'online',
    connection: 'CONNECTED',
    connectionDetail: null,
    state: 'LOGGED_OUT',
    user: null,
    phoneMasked: null,
    codeType: null,
    nextCodeType: null,
    codeResendAt: null,
    lastError: null,
    dialogsRefreshedAt: null,
    ...overrides,
  };
}

export function makeReadyStatus(overrides: Partial<TelegramStatusDto> = {}): TelegramStatusDto {
  return makeTelegramStatus({
    state: 'READY',
    user: { id: '424242', username: 'archivist', displayName: 'An Archivist' },
    phoneMasked: '+84•••••••78',
    dialogsRefreshedAt: '2026-09-24T08:00:00.000Z',
    ...overrides,
  });
}

let dialogSequence = 0;

export function makeDialog(overrides: Partial<TelegramDialogDto> = {}): TelegramDialogDto {
  dialogSequence += 1;
  return {
    telegramChatId: `-100${2_000_000_000 + dialogSequence}`,
    title: `Study Group ${dialogSequence}`,
    username: null,
    type: 'SUPERGROUP',
    isProtected: false,
    isForum: false,
    memberCount: 120,
    archivedChannelId: null,
    canPost: false,
    canManageTopics: false,
    backupLocationId: null,
    lastSeenAt: '2026-09-24T08:00:00.000Z',
    ...overrides,
  };
}

export function makeDialogList(
  items: TelegramDialogDto[],
  overrides: Partial<TelegramDialogListDto> = {},
): TelegramDialogListDto {
  return { items, refreshing: false, refreshedAt: '2026-09-24T08:00:00.000Z', ...overrides };
}

let mediaSequence = 0;

/** A 90 MiB video of 12 minutes, not downloaded yet, with a Telegram preview. */
export function makeMediaSummary(overrides: Partial<MediaSummaryDto> = {}): MediaSummaryDto {
  mediaSequence += 1;
  return {
    id: `0199a0b1-0000-7000-8000-e${String(mediaSequence).padStart(11, '0')}`,
    type: 'VIDEO',
    fileName: `Lesson ${mediaSequence}.mp4`,
    mimeType: 'video/mp4',
    size: 90 * 1024 ** 2,
    width: 1280,
    height: 720,
    duration: 720,
    downloadStatus: 'PENDING',
    downloadProgress: 0,
    hasThumbnail: true,
    ...overrides,
  };
}

/** The same video as GET /api/media/:id describes it. */
export function makeMedia(overrides: Partial<MediaDto> = {}): MediaDto {
  return {
    ...makeMediaSummary(),
    messageId: '0199a0b1-0000-7000-8000-d00000000001',
    channelId: '0199a0b1-0000-7000-8000-000000000001',
    telegramMessageId: 42,
    postedAt: '2026-03-01T10:00:00.000Z',
    downloadedBytes: 0,
    skipReason: null,
    stage: null,
    requested: false,
    attempts: 0,
    error: null,
    checksum: null,
    storageLocation: null,
    storageKey: null,
    updatedAt: '2026-09-24T08:00:00.000Z',
    ...overrides,
  };
}

let messageSequence = 0;

/** A video message of "Physics Notes" posted on 1 March 2026. */
export function makeMessage(overrides: Partial<MessageSummaryDto> = {}): MessageSummaryDto {
  messageSequence += 1;
  return {
    id: `0199a0b1-0000-7000-8000-d${String(messageSequence).padStart(11, '0')}`,
    channel: { id: '0199a0b1-0000-7000-8000-000000000001', title: 'Physics Notes' },
    telegramMessageId: 100 + messageSequence,
    type: 'VIDEO',
    postedAt: '2026-03-01T10:00:00.000Z',
    excerpt: null,
    mediaGroupId: null,
    topic: null,
    media: makeMediaSummary(),
    isFavorite: false,
    tags: [],
    ...overrides,
  };
}

/** A message as GET /api/messages/:id describes it (a video, not in an album). */
export function makeMessageDetail(overrides: Partial<MessageDto> = {}): MessageDto {
  const summary = makeMessage();
  return {
    ...summary,
    media: makeMedia({ messageId: summary.id, telegramMessageId: summary.telegramMessageId }),
    text: null,
    caption: null,
    entities: [],
    editedAt: null,
    views: null,
    forwards: null,
    postAuthor: null,
    pinned: false,
    serviceAction: null,
    forward: null,
    replyTo: null,
    album: [],
    previousId: null,
    nextId: null,
    telegramUrl: null,
    favoritedAt: null,
    backups: [],
    ...overrides,
  };
}

export function makeMessagePage(
  items: MessageSummaryDto[],
  nextCursor: string | null = null,
  total: number | null = items.length,
  totalCapped = false,
): MessagePageDto {
  return { items, nextCursor, total, totalCapped };
}

let topicSequence = 1;

export function makeTopic(overrides: Partial<ForumTopicDto> = {}): ForumTopicDto {
  topicSequence += 1;
  return {
    topicId: topicSequence * 10,
    title: `Module ${topicSequence}`,
    iconColor: '#6fb9f0',
    isClosed: false,
    isPinned: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    counts: { messages: 12, videos: 10, images: 0, documents: 2, audio: 0 },
    firstPostedAt: '2026-01-02T00:00:00.000Z',
    lastPostedAt: '2026-02-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeTopicList(
  topics: ForumTopicDto[],
  overrides: Partial<ForumTopicListDto> = {},
): ForumTopicListDto {
  return { forum: true, refreshedAt: '2026-09-24T08:00:00.000Z', topics, ...overrides };
}

let tagSequence = 0;

export function makeTag(overrides: Partial<TagDto> = {}): TagDto {
  tagSequence += 1;
  return {
    id: `0199a0b1-0000-7000-8000-e${String(tagSequence).padStart(11, '0')}`,
    name: `Tag ${tagSequence}`,
    color: '#1e88e5',
    messageCount: 3,
    createdAt: '2026-09-01T00:00:00.000Z',
    ...overrides,
  };
}

export function makeTagList(tags: TagDto[]): TagListDto {
  return { items: tags };
}

/** A tag as messages carry it. */
export function tagRef(tag: TagDto): TagRefDto {
  return { id: tag.id, name: tag.name, color: tag.color };
}

/** Answers a pending request with an error body shaped like the API's. */
export function flushError(
  request: TestRequest,
  status: number,
  message = 'Request failed',
  code?: string,
  details?: unknown,
): void {
  const statusText = STATUS_TEXT[status] ?? 'Error';
  const body: ApiErrorBody = { statusCode: status, error: statusText, message, code, details };
  request.flush(body, { status, statusText });
}

/** Simulates a request that never reached the server (offline, API down). */
export function failNetwork(request: TestRequest): void {
  request.error(new ProgressEvent('error'), { status: 0, statusText: 'Unknown Error' });
}
