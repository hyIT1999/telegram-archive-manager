import type { TestRequest } from '@angular/common/http/testing';
import type {
  ApiErrorBody,
  AuthUserDto,
  ChannelDto,
  Page,
  StatsDto,
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
    createdAt: '2026-09-01T10:00:00.000Z',
    updatedAt: '2026-09-23T21:15:00.000Z',
    stats: { messages: 4_812, media: 640, downloadedMedia: 600, storageBytes: 3 * 1024 ** 3 },
    ...overrides,
  };
}

export function makePage<T>(items: T[], nextCursor: string | null = null): Page<T> {
  return { items, nextCursor };
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
