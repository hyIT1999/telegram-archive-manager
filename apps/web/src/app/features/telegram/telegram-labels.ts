import {
  type TelegramDialogDto,
  type TelegramStatusDto,
  retryAfterSeconds,
  toApiError,
  validationMessage,
} from '../../shared/models';
import type { NoticeTone } from '../../shared/components/notice/notice';

export interface ConnectionNotice {
  readonly tone: NoticeTone;
  readonly icon: string;
  readonly title: string;
  readonly message: string;
}

/** Why Telegram cannot be used right now, or null when the worker is connected. */
export function connectionNotice(status: TelegramStatusDto): ConnectionNotice | null {
  if (status.worker === 'offline') {
    return {
      tone: 'warning',
      icon: 'power_off',
      title: 'The background worker is not running',
      message:
        'Telegram is reached through the worker. Start it (npm run dev starts everything); ' +
        'this page notices when it is up.',
    };
  }
  const detail = status.connectionDetail;
  switch (status.connection) {
    case 'CONNECTED':
      return null;
    case 'UNCONFIGURED':
      return {
        tone: 'warning',
        icon: 'key_off',
        title: 'Telegram is not set up on the worker',
        message:
          `${detail ?? 'The Telegram settings are missing'}. Add the API ID and hash of your ` +
          'app from my.telegram.org to .env (README §4), then restart the worker.',
      };
    case 'CONNECTING':
      return {
        tone: 'info',
        icon: 'sync',
        title: 'Connecting to Telegram…',
        message: 'This usually takes a few seconds.',
      };
    case 'ERROR':
      return {
        tone: 'error',
        icon: 'cloud_off',
        title: 'The worker cannot reach Telegram',
        message: `${detail ?? 'The connection failed'}. It keeps trying on its own.`,
      };
    case 'STANDBY':
    default:
      return {
        tone: 'info',
        icon: 'hourglass_top',
        title: 'Waiting for the Telegram connection',
        message: detail && detail !== 'Starting' ? `${detail}.` : 'The worker is starting.',
      };
  }
}

/** What happened to the login code, shown above the code field. */
export function codeDeliveryText(codeType: string | null): string {
  switch (codeType) {
    case 'app':
      return 'Telegram sent a login code to your Telegram app. Look for a message from “Telegram” on a device where you are signed in.';
    case 'sms':
    case 'sms_word':
    case 'sms_phrase':
    case 'firebase':
      return 'Telegram sent a login code by SMS.';
    case 'call':
      return 'Telegram is calling you to read out a login code.';
    case 'flash_call':
    case 'missed_call':
      return 'Telegram is calling you. The code is the last digits of the calling number.';
    case 'email':
      return 'Telegram sent a login code by email.';
    case 'fragment':
      return 'Telegram sent a login code to your Fragment account.';
    default:
      return 'Telegram sent a login code.';
  }
}

/** Label of the "send the code again" action, or null when Telegram offers no other way. */
export function resendLabel(nextCodeType: string | null): string | null {
  switch (nextCodeType) {
    case null:
    case 'none':
      return null;
    case 'sms':
    case 'sms_word':
    case 'sms_phrase':
    case 'firebase':
      return 'Send the code by SMS';
    case 'call':
      return 'Call me with the code';
    case 'flash_call':
    case 'missed_call':
      return 'Get the code by a call';
    case 'email':
      return 'Send the code by email';
    case 'fragment':
      return 'Send the code via Fragment';
    default:
      return 'Send a new code';
  }
}

/** Word and phrase codes contain letters; everything else is digits (numeric keypad). */
export function isNumericCode(codeType: string | null): boolean {
  return codeType !== 'sms_word' && codeType !== 'sms_phrase';
}

/** A sentence for a failed Telegram action, from what the api and Telegram reported. */
export function telegramActionError(error: unknown): string {
  const apiError = toApiError(error);
  switch (apiError.code) {
    case 'FLOOD_WAIT': {
      const seconds = retryAfterSeconds(error);
      return seconds === null
        ? apiError.message
        : `Telegram asks to wait ${formatWait(seconds)} before the next attempt.`;
    }
    case 'RATE_LIMITED':
      return 'Too many attempts. Wait a minute, then try again.';
    case 'VALIDATION_FAILED':
      return validationMessage(error) ?? apiError.message;
    default:
      return apiError.message;
  }
}

/** "45 seconds", "3 minutes", "2 hours 5 minutes". */
export function formatWait(seconds: number): string {
  if (seconds < 60) {
    return plural(Math.max(1, Math.ceil(seconds)), 'second');
  }
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) {
    return plural(minutes, 'minute');
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? plural(hours, 'hour') : `${plural(hours, 'hour')} ${plural(rest, 'minute')}`;
}

/** "0:45", "12:03". */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

export type ChatFilter = 'all' | 'channels' | 'groups';

/** Chats whose title or username contains the query (ignoring case and accents) and type. */
export function filterChats(
  chats: readonly TelegramDialogDto[],
  query: string,
  filter: ChatFilter,
): TelegramDialogDto[] {
  const needle = foldText(query);
  return chats.filter(
    (chat) =>
      (filter === 'all' || (filter === 'channels') === (chat.type === 'CHANNEL')) &&
      (!needle ||
        foldText(chat.title).includes(needle) ||
        (chat.username !== null && foldText(chat.username).includes(needle))),
  );
}

/** Lower case without accents, so "hoc" finds "Học" (and "đ" matches "d"). */
export function foldText(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim();
}
