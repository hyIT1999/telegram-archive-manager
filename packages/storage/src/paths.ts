import { UnsafeKeyError } from './errors.js';

/**
 * Readable layout inside a storage location, so the archive reads like a copy of the channel:
 *
 *   <Channel title (chat id)>/<YYYY-MM>/<message id> - <original file name>
 *
 * Keys use "/" between segments. Every segment is a name that is valid on Windows, Linux, macOS
 * and Google Drive alike; drivers still check each key before touching storage.
 */

export const CHANNEL_TITLE_MAX_LENGTH = 60;
export const FILE_NAME_MAX_LENGTH = 100;

const MAX_KEY_LENGTH = 1_024;
const MAX_SEGMENT_LENGTH = 200;
/** Longest extension kept when a long file name is shortened, dot included (".webm"). */
const MAX_EXTENSION_LENGTH = 11;

// Control characters are exactly what must never reach a file name.
// eslint-disable-next-line no-control-regex
const INVALID_CHARACTERS = /[\u0000-\u001f\u007f<>:"/\\|?*]/gu;
// eslint-disable-next-line no-control-regex
const HAS_INVALID_CHARACTER = /[\u0000-\u001f\u007f<>:"/\\|?*]/u;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/iu;

function truncate(text: string, maxLength: number): string {
  const characters = Array.from(text);
  return characters.length <= maxLength ? text : characters.slice(0, maxLength).join('');
}

/** Removes what Windows does not allow at the end of a name. */
function trimEnd(text: string): string {
  return text.replace(/[. ]+$/u, '');
}

function clean(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\s+/gu, ' ')
    .replace(INVALID_CHARACTERS, '_')
    .trim()
    .replace(/^\.+/u, '');
}

function avoidReservedName(name: string): string {
  return WINDOWS_RESERVED_NAME.test(name) ? `_${name}` : name;
}

/**
 * Turns any text (a chat title, a file name from Telegram) into a single safe path segment:
 * no path separators or forbidden characters, no leading dots (hidden files), no trailing dots or
 * spaces, no reserved Windows device names, at most `maxLength` characters.
 */
export function sanitizeName(value: string, maxLength: number, fallback: string): string {
  const name = trimEnd(truncate(clean(value), maxLength));
  return avoidReservedName(name === '' ? fallback : name);
}

/** Like sanitizeName, but keeps the extension when the name has to be shortened. */
export function sanitizeFileName(
  value: string,
  maxLength = FILE_NAME_MAX_LENGTH,
  fallback = 'file',
): string {
  const cleaned = trimEnd(clean(value));
  const dot = cleaned.lastIndexOf('.');
  const extension =
    dot > 0 && cleaned.length - dot <= MAX_EXTENSION_LENGTH ? cleaned.slice(dot) : '';
  const base = extension ? cleaned.slice(0, dot) : cleaned;
  const room = Math.max(1, maxLength - Array.from(extension).length);
  const shortened = trimEnd(truncate(base, room));
  return avoidReservedName((shortened === '' ? fallback : shortened) + extension);
}

/** "Physics Notes (-1001234567890)": the channel's folder, fixed when its location is chosen. */
export function channelFolderName(title: string, telegramChatId: string): string {
  if (!/^-?\d{1,20}$/.test(telegramChatId)) {
    throw new UnsafeKeyError(telegramChatId);
  }
  return `${sanitizeName(title, CHANNEL_TITLE_MAX_LENGTH, 'Chat')} (${telegramChatId})`;
}

/** "2026-09" (UTC), grouping a channel's files by the month they were posted. */
export function monthFolder(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export interface MediaFileNameParts {
  telegramMessageId: number;
  /** Original file name from Telegram, when the file has one (documents, most videos). */
  fileName?: string | null;
  /** Used when there is no file name (photos): "jpg", "mp4", … */
  extension?: string | null;
}

/** "123 - lecture.pdf", or "123.jpg" for files without a name of their own. */
export function mediaFileName({ telegramMessageId, fileName, extension }: MediaFileNameParts): string {
  if (fileName?.trim()) {
    return `${telegramMessageId} - ${sanitizeFileName(fileName)}`;
  }
  const suffix = extension ? sanitizeName(extension.replace(/^\.+/u, ''), 10, '') : '';
  return suffix ? `${telegramMessageId}.${suffix}` : String(telegramMessageId);
}

export interface MediaPathParts extends MediaFileNameParts {
  /** The channel's folder (channelFolderName), as stored on the channel. */
  channelFolder: string;
  /** When the message was posted on Telegram. */
  postedAt: Date;
}

/** "<channel folder>/<YYYY-MM>/<message id> - <file name>". */
export function buildMediaPath(parts: MediaPathParts): string {
  return assertSafeKey(
    [parts.channelFolder, monthFolder(parts.postedAt), mediaFileName(parts)].join('/'),
  );
}

function isSafeSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    segment.length <= MAX_SEGMENT_LENGTH &&
    segment !== '.' &&
    segment !== '..' &&
    segment === segment.trim() &&
    !segment.endsWith('.') &&
    !HAS_INVALID_CHARACTER.test(segment) &&
    !WINDOWS_RESERVED_NAME.test(segment)
  );
}

/** The key's segments, after checking that none can escape the location or break a platform. */
export function splitKey(key: string): string[] {
  const segments = key.split('/');
  if (key.length === 0 || key.length > MAX_KEY_LENGTH || !segments.every(isSafeSegment)) {
    throw new UnsafeKeyError(key);
  }
  return segments;
}

/** Throws UnsafeKeyError for keys that are empty, absolute, contain ".." or invalid names. */
export function assertSafeKey(key: string): string {
  splitKey(key);
  return key;
}
