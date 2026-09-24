import { MediaType, MessageType } from '@tam/shared';
import {
  type Chat,
  type HistoryPage,
  type HistoryPageOptions,
  type LegacyGroup,
  MAX_HISTORY_PAGE,
  type Message,
  encodeFileId,
} from '@tam/telegram';
import type { createFakeTelegramApi } from './telegram-fixtures.js';

/** Message n of a chat is dated BASE_TIME + n minutes. */
export const BASE_TIME = Date.UTC(2026, 0, 1);

export function dateOf(id: number): Date {
  return new Date(BASE_TIME + id * 60_000);
}

export function textMessage(chatId: string, id: number, overrides: Partial<Message> = {}): Message {
  return {
    id: String(id),
    chatId,
    date: dateOf(id),
    editDate: null,
    type: MessageType.TEXT,
    text: `Message ${id}`,
    caption: null,
    entities: null,
    replyToMessageId: null,
    threadId: null,
    mediaGroupId: null,
    forward: null,
    views: 10,
    isService: false,
    isContentProtected: false,
    ttlPeriod: null,
    media: [],
    meta: {},
    ...overrides,
  };
}

/** A message carrying one photo of `size` bytes. */
export function photoMessage(
  chatId: string,
  id: number,
  size = 1_000,
  overrides: Partial<Message> = {},
): Message {
  const fileUniqueId = `photo-${chatId}-${id}`;
  return textMessage(chatId, id, {
    type: MessageType.PHOTO,
    text: null,
    caption: `Photo ${id}`,
    media: [
      {
        fileId: encodeFileId({ chatId, messageId: String(id), fileUniqueId }),
        fileUniqueId,
        type: MediaType.PHOTO,
        fileName: null,
        mimeType: 'image/jpeg',
        size,
        width: 800,
        height: 600,
        duration: null,
        hasThumbnail: true,
        isSelfDestructing: false,
      },
    ],
    ...overrides,
  });
}

/** Messages 1…count of a chat; every tenth one carries a photo. */
export function history(chatId: string, count: number, from = 1): Message[] {
  return Array.from({ length: count }, (_, index) => {
    const id = from + index;
    return id % 10 === 0 ? photoMessage(chatId, id) : textMessage(chatId, id);
  });
}

export function chatInfo(id: string, overrides: Partial<Chat> = {}): Chat {
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
    ...overrides,
  };
}

type FakeApi = ReturnType<typeof createFakeTelegramApi>['api'];

/**
 * In-memory Telegram chats answering the history calls of the fake adapter with the same
 * contract as MtcuteTelegramAdapter: exclusive cursors, at most 100 messages per call, newest
 * first for history pages and oldest first for newer messages.
 */
export class FakeChats {
  private readonly chats = new Map<string, Chat>();
  private readonly messages = new Map<string, Map<number, Message>>();
  private readonly oldGroups = new Map<string, LegacyGroup>();

  constructor(private readonly api: FakeApi) {
    api.refreshChat.mockImplementation(async (chatId) => this.chat(chatId));
    api.getHistoryPage.mockImplementation(async (chatId, options) => this.page(chatId, options));
    api.getNewerMessages.mockImplementation(async (chatId, after, limit) =>
      this.newer(chatId, after, limit),
    );
    api.getLegacyGroup.mockImplementation(async (chatId) => this.oldGroups.get(chatId) ?? null);
    api.getMessages.mockImplementation(async (chatId, ids) =>
      ids.flatMap((id) => {
        const message = this.messages.get(chatId)?.get(Number(id));
        return message ? [message] : [];
      }),
    );
  }

  addChat(chat: Chat, messages: readonly Message[] = []): void {
    this.chats.set(chat.id, chat);
    this.messages.set(chat.id, new Map());
    this.post(chat.id, ...messages);
  }

  /** New (or edited) messages arrive in a chat. */
  post(chatId: string, ...messages: readonly Message[]): void {
    const chat = this.messages.get(chatId);
    if (!chat) {
      throw new Error(`Unknown fake chat ${chatId}`);
    }
    for (const message of messages) {
      chat.set(Number(message.id), message);
    }
  }

  /** The old basic group of an upgraded supergroup, readable by this account. */
  addOldGroup(group: LegacyGroup, messages: readonly Message[]): void {
    this.oldGroups.set(group.id, group);
    this.addChat(
      chatInfo(group.id, { title: group.title, type: 'GROUP', accessHash: null }),
      messages,
    );
  }

  update(chatId: string, changes: Partial<Chat>): void {
    this.chats.set(chatId, { ...this.chat(chatId), ...changes });
  }

  private chat(chatId: string): Chat {
    const chat = this.chats.get(chatId);
    if (!chat) {
      throw new Error(`Unknown fake chat ${chatId}`);
    }
    return chat;
  }

  private all(chatId: string): Message[] {
    this.chat(chatId);
    return [...(this.messages.get(chatId)?.values() ?? [])].sort(
      (a, b) => Number(b.id) - Number(a.id),
    );
  }

  private page(chatId: string, options: HistoryPageOptions = {}): HistoryPage {
    const limit = Math.min(options.limit ?? MAX_HISTORY_PAGE, MAX_HISTORY_PAGE);
    const all = this.all(chatId);
    const before =
      options.beforeMessageId === undefined ? undefined : Number(options.beforeMessageId);
    const beforeDate = options.beforeDate;
    const matching = all.filter((message) =>
      before !== undefined
        ? Number(message.id) < before
        : beforeDate === undefined || message.date.getTime() < beforeDate.getTime(),
    );
    return { messages: matching.slice(0, limit), total: all.length };
  }

  private newer(chatId: string, afterMessageId: string, limit = MAX_HISTORY_PAGE): Message[] {
    const after = Number(afterMessageId);
    return this.all(chatId)
      .filter((message) => Number(message.id) > after)
      .reverse()
      .slice(0, Math.min(limit, MAX_HISTORY_PAGE));
  }
}
