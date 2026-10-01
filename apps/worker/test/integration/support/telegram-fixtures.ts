import { randomBytes } from 'node:crypto';
import { PrismaService } from '@tam/database/nest';
import { SecretBox } from '@tam/crypto';
import type { Chat, ForumTopic, TelegramUser } from '@tam/telegram';
import { inject, vi } from 'vitest';
import type { TelegramApi, TelegramApiProvider } from '../../../src/telegram/telegram.tokens.js';

export const TEST_USER: TelegramUser = { id: '424242', username: 'archivist', displayName: 'An Archivist' };

/** A scripted stand-in for the mtcute adapter; every method is a vi.fn that tests can override. */
export function createFakeTelegramApi() {
  const api = {
    getAuthorizedUser: vi.fn<TelegramApi['getAuthorizedUser']>(async () => null),
    sendCode: vi.fn<TelegramApi['sendCode']>(async (phone) => ({
      kind: 'code_sent',
      phoneCodeHash: `hash-for-${phone}`,
      codeType: 'app',
      nextCodeType: 'sms',
      resendAfterSeconds: 60,
    })),
    resendCode: vi.fn<TelegramApi['resendCode']>(async () => ({
      kind: 'code_sent',
      phoneCodeHash: 'hash-resent',
      codeType: 'sms',
      nextCodeType: 'call',
      resendAfterSeconds: 90,
    })),
    signIn: vi.fn<TelegramApi['signIn']>(async () => ({ kind: 'authorized', user: TEST_USER })),
    checkPassword: vi.fn<TelegramApi['checkPassword']>(async () => TEST_USER),
    logOut: vi.fn<TelegramApi['logOut']>(async () => undefined),
    getChats: vi.fn<TelegramApi['getChats']>(async () => []),
    // History: scripted by FakeChats (fake-chats.ts) in the import tests.
    getHistoryPage: vi.fn<TelegramApi['getHistoryPage']>(async () => ({ messages: [], total: 0 })),
    getNewerMessages: vi.fn<TelegramApi['getNewerMessages']>(async () => []),
    getMessages: vi.fn<TelegramApi['getMessages']>(async () => []),
    refreshChat: vi.fn<TelegramApi['refreshChat']>(async (chatId) => chat(chatId)),
    getLegacyGroup: vi.fn<TelegramApi['getLegacyGroup']>(async () => null),
    getForumTopics: vi.fn<TelegramApi['getForumTopics']>(async () => []),
    // Media: scripted by FakeFiles (fake-files.ts) in the download tests.
    downloadFile: vi.fn<TelegramApi['downloadFile']>(async () => {
      throw new Error('No fake file was set up');
    }),
    getThumbnails: vi.fn<TelegramApi['getThumbnails']>(async () => new Map()),
    // Backups: scripted by FakeBackupChat (fake-backup-chat.ts) in the backup tests.
    openBackupSource: vi.fn<TelegramApi['openBackupSource']>(async () => {
      throw new Error('No fake backup chat was set up');
    }),
    uploadBackupFile: vi.fn<TelegramApi['uploadBackupFile']>(async () => {
      throw new Error('No fake backup chat was set up');
    }),
    sendBackup: vi.fn<TelegramApi['sendBackup']>(async () => {
      throw new Error('No fake backup chat was set up');
    }),
    createForumTopic: vi.fn<TelegramApi['createForumTopic']>(async () => {
      throw new Error('No fake backup chat was set up');
    }),
    getBackupMessages: vi.fn<TelegramApi['getBackupMessages']>(async () => []),
    getBackupHistory: vi.fn<TelegramApi['getBackupHistory']>(async () => []),
    readBackupFileHead: vi.fn<TelegramApi['readBackupFileHead']>(async () => 0),
    deleteBackupMessages: vi.fn<TelegramApi['deleteBackupMessages']>(async () => undefined),
  } satisfies TelegramApi;
  const provider: TelegramApiProvider = { api };
  return { api, provider };
}

export function chat(id: string, overrides: Partial<Chat> = {}): Chat {
  return {
    id,
    title: `Chat ${id}`,
    username: null,
    type: 'CHANNEL',
    accessHash: '1234',
    isForum: false,
    isProtected: false,
    memberCount: 10,
    migratedFromChatId: null,
    canPost: false,
    canManageTopics: false,
    ...overrides,
  };
}

export function randomSecretBox(): SecretBox {
  return SecretBox.fromBase64(randomBytes(32).toString('base64'));
}

export function testPrisma(): PrismaService {
  return new PrismaService({ url: inject('databaseUrl'), poolMax: 4, applicationName: 'tam-worker-tests' });
}

/** Empties the tables the Telegram module, the importer and the downloader write. */
export async function resetTelegramTables(prisma: PrismaService): Promise<void> {
  await prisma.$executeRaw`
    TRUNCATE TABLE telegram_dialogs, telegram_accounts, channels, messages, media, import_jobs,
      download_jobs, storage_locations, app_settings, forum_topics CASCADE`;
}

/** A forum topic as the adapter reports it. */
export function forumTopic(id: number, overrides: Partial<ForumTopic> = {}): ForumTopic {
  return {
    id,
    title: id === 1 ? 'General' : `Lesson ${id}`,
    iconColor: 0x6fb9f0,
    isClosed: false,
    isPinned: false,
    isHidden: false,
    date: new Date(Date.UTC(2026, 0, 1) + id * 60_000),
    createdByMe: false,
    ...overrides,
  };
}
