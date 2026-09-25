import type { ChatType } from './enums.js';

/** What a t.me link needs to know about the chat. */
export interface TelegramLinkChat {
  type: ChatType;
  username: string | null;
  /** Marked chat id as a decimal string: -100… for channels and supergroups. */
  telegramChatId: string;
}

const CHANNEL_ID_PREFIX = '-100';

/**
 * The t.me link of a message: the public link when the chat has a username, the members-only
 * t.me/c link for other channels and supergroups, and null for basic groups (Telegram has no
 * message links for them). Either way only people who can read the chat can open it.
 */
export function telegramMessageUrl(chat: TelegramLinkChat, messageId: number): string | null {
  if (!Number.isSafeInteger(messageId) || messageId <= 0) {
    return null;
  }
  if (chat.username) {
    return `https://t.me/${encodeURIComponent(chat.username)}/${messageId}`;
  }
  if (chat.type !== 'GROUP' && /^-100\d+$/.test(chat.telegramChatId)) {
    return `https://t.me/c/${chat.telegramChatId.slice(CHANNEL_ID_PREFIX.length)}/${messageId}`;
  }
  return null;
}
