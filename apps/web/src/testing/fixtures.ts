import type { TestRequest } from '@angular/common/http/testing';
import type {
  ApiErrorBody,
  AuthUserDto,
  ChannelDownloadsDto,
  ChannelDto,
  ImportJobDto,
  Page,
  SettingsDto,
  StatsDto,
  StorageCheckDto,
  StorageLocationDto,
  StorageLocationListDto,
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
    headMessageId: 4_812,
    backfillComplete: true,
    lastSyncedAt: '2026-09-23T21:15:00.000Z',
    migratedToChannelId: null,
    storageLocation: null,
    storageFolder: null,
    downloadMedia: true,
    downloadNote: null,
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
  const channelId = overrides.channelId ?? `0199a0b1-0000-7000-8000-c${String(jobSequence).padStart(11, '0')}`;
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
    currentFile: null,
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

export function makeStorageLocation(overrides: Partial<StorageLocationDto> = {}): StorageLocationDto {
  locationSequence += 1;
  return {
    id: `0199a0b1-0000-7000-8000-5${String(locationSequence).padStart(11, '0')}`,
    kind: 'LOCAL',
    name: `Archive ${locationSequence}`,
    displayPath: `D:\\Archive\\Folder ${locationSequence}`,
    accountEmail: null,
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
export function makeChannelDownloads(overrides: Partial<ChannelDownloadsDto> = {}): ChannelDownloadsDto {
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

/** The download settings as the server starts: everything, two at a time. */
export function makeSettings(overrides: Partial<SettingsDto['downloads']> = {}): SettingsDto {
  return {
    downloads: {
      paused: false,
      mediaTypes: ['PHOTO', 'VIDEO', 'DOCUMENT', 'AUDIO', 'VOICE', 'ANIMATION', 'VIDEO_NOTE', 'STICKER'],
      maxFileSizeMb: null,
      concurrency: 2,
      ...overrides,
    },
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
