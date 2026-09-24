import { type SentCode, User as MtUser, tl } from '@mtcute/core';
import type { TelegramClient as MtTelegramClient } from '@mtcute/core/client.js';
import { TelegramAuthState, TelegramErrorCode } from '@tam/shared';
import { AuthRequiredError, LoginStepError, TelegramError } from '../errors.js';
import type { SendCodeResult, SignInResult, TelegramLoginApi } from '../login-api.js';
import type { TelegramClient, TelegramHistoryReader } from '../telegram-client.js';
import type { AuthState, Chat, Message, TelegramUser } from '../types.js';
import { toTelegramError, translateErrors } from './error-mapping.js';
import { mapChat, mapMessage, mapUser } from './mappers.js';

/** messages.getHistory never returns more than this per call. */
export const MAX_HISTORY_PAGE = 100;

/**
 * The real Telegram adapter, on top of mtcute. It is stateless: the pending-login state lives in
 * the worker's database, and mtcute's session storage holds the (encrypted) auth key.
 *
 * Downloads (Phase 4) and realtime updates (Phase 7) complete the TelegramClient interface later;
 * until then the adapter implements the parts the worker uses.
 */
export class MtcuteTelegramAdapter
  implements
    TelegramLoginApi,
    TelegramHistoryReader,
    Pick<TelegramClient, 'authenticate' | 'getChats' | 'getChatHistory'>
{
  constructor(private readonly tg: MtTelegramClient) {}

  async authenticate(): Promise<AuthState> {
    const user = await this.getAuthorizedUser();
    return {
      state: user ? TelegramAuthState.READY : TelegramAuthState.LOGGED_OUT,
      user,
      phoneMasked: null,
      codeType: null,
      nextCodeType: null,
      codeExpiresAt: null,
    };
  }

  async getAuthorizedUser(): Promise<TelegramUser | null> {
    try {
      return mapUser(await this.tg.getMe());
    } catch (error) {
      const translated = toTelegramError(error);
      if (translated instanceof AuthRequiredError) {
        return null;
      }
      throw translated;
    }
  }

  async sendCode(phoneNumber: string): Promise<SendCodeResult> {
    const result = await translateErrors(() => this.tg.sendCode({ phone: phoneNumber }));
    return result instanceof MtUser ? { kind: 'authorized', user: mapUser(result) } : fromSentCode(result);
  }

  async resendCode(phoneNumber: string, phoneCodeHash: string): Promise<SendCodeResult> {
    return fromSentCode(
      await translateErrors(() => this.tg.resendCode({ phone: phoneNumber, phoneCodeHash })),
    );
  }

  async signIn(phoneNumber: string, phoneCodeHash: string, code: string): Promise<SignInResult> {
    try {
      const user = await this.tg.signIn({ phone: phoneNumber, phoneCodeHash, phoneCode: code });
      return { kind: 'authorized', user: mapUser(user) };
    } catch (error) {
      if (tl.RpcError.is(error, 'SESSION_PASSWORD_NEEDED')) {
        return { kind: 'password_required' };
      }
      throw toTelegramError(error);
    }
  }

  async checkPassword(password: string): Promise<TelegramUser> {
    return mapUser(await translateErrors(() => this.tg.checkPassword(password)));
  }

  async logOut(): Promise<void> {
    await translateErrors(() => this.tg.logOut());
  }

  /** Channels, supergroups and basic groups in the account's dialogs (archived folder included). */
  async getChats(): Promise<Chat[]> {
    return translateErrors(async () => {
      const chats: Chat[] = [];
      for await (const dialog of this.tg.iterDialogs({ archived: 'keep' })) {
        const peer = dialog.peer;
        if (peer.type !== 'chat') {
          continue;
        }
        const chat = mapChat(peer);
        if (chat) {
          chats.push(chat);
        }
      }
      return chats;
    });
  }

  async refreshChat(chatId: string): Promise<Chat> {
    const chat = mapChat(await translateErrors(() => this.tg.getChat(toPeerId(chatId))));
    if (!chat) {
      throw new TelegramError(
        `Chat ${chatId} is no longer an accessible channel or group`,
        TelegramErrorCode.TELEGRAM_ERROR,
      );
    }
    return chat;
  }

  /** Newest → oldest, strictly older than `fromMessageId`; empty when history is exhausted. */
  async getChatHistory(chatId: string, fromMessageId?: string, limit = MAX_HISTORY_PAGE): Promise<Message[]> {
    const messages = await translateErrors(() =>
      this.tg.getHistory(toPeerId(chatId), {
        limit: clampLimit(limit),
        ...(fromMessageId === undefined ? {} : { offset: { id: toMessageId(fromMessageId), date: 0 } }),
      }),
    );
    return messages
      .filter((message) => fromMessageId === undefined || message.id < toMessageId(fromMessageId))
      .map((message) => mapMessage(message, chatId))
      .sort((a, b) => Number(b.id) - Number(a.id));
  }

  /** Oldest → newest, strictly newer than `afterMessageId`. */
  async getNewerMessages(chatId: string, afterMessageId: string, limit = MAX_HISTORY_PAGE): Promise<Message[]> {
    const after = toMessageId(afterMessageId);
    const messages = await translateErrors(() =>
      this.tg.getHistory(toPeerId(chatId), {
        limit: clampLimit(limit),
        reverse: true,
        offset: { id: after + 1, date: 0 },
      }),
    );
    return messages
      .filter((message) => message.id > after)
      .map((message) => mapMessage(message, chatId))
      .sort((a, b) => Number(a.id) - Number(b.id));
  }

  async getMessages(chatId: string, messageIds: string[]): Promise<Message[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const messages = await translateErrors(() =>
      this.tg.getMessages(toPeerId(chatId), messageIds.map(toMessageId)),
    );
    return messages.flatMap((message) => (message ? [mapMessage(message, chatId)] : []));
  }
}

function fromSentCode(code: SentCode): SendCodeResult {
  if (code.type === 'email_required') {
    throw new LoginStepError(
      TelegramErrorCode.EMAIL_REQUIRED,
      'Telegram asks this account to set up a login email in an official Telegram app first',
    );
  }
  return {
    kind: 'code_sent',
    phoneCodeHash: code.phoneCodeHash,
    codeType: code.type,
    nextCodeType: code.nextType,
    resendAfterSeconds: code.timeout,
  };
}

function clampLimit(limit: number): number {
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_HISTORY_PAGE);
}

function toPeerId(chatId: string): number {
  const id = Number(chatId);
  if (!/^-?\d+$/.test(chatId) || !Number.isSafeInteger(id)) {
    throw new TelegramError(`Invalid chat id: ${chatId}`, TelegramErrorCode.TELEGRAM_ERROR);
  }
  return id;
}

function toMessageId(messageId: string): number {
  const id = Number(messageId);
  if (!/^\d+$/.test(messageId) || !Number.isSafeInteger(id)) {
    throw new TelegramError(`Invalid message id: ${messageId}`, TelegramErrorCode.TELEGRAM_ERROR);
  }
  return id;
}
