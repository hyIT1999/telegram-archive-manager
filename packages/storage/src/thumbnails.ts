import path from 'node:path';
import { UnsafeKeyError } from './errors.js';

/** Default folder of the thumbnail cache inside STORAGE_LOCAL_ROOT (hidden, like every dot folder). */
export const THUMBNAIL_FOLDER = '.tam-thumbnails';

export type ThumbnailExtension = 'jpg' | 'png' | 'webp';

const CONTENT_TYPES: Readonly<Record<ThumbnailExtension, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const KEY_PATTERN = /^[0-9a-f]{2}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

/** The image format of a thumbnail Telegram sent, from its first bytes; null when unknown. */
export function thumbnailExtension(bytes: Uint8Array): ThumbnailExtension | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpg';
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return 'png';
  }
  const header = Buffer.from(bytes.subarray(0, 12)).toString('latin1');
  if (header.startsWith('RIFF') && header.slice(8, 12) === 'WEBP') {
    return 'webp';
  }
  return null;
}

/**
 * "7f/0199…c27f.jpg": a media file's preview in the thumbnail cache, spread over 256 folders by
 * the last two hex digits of its id.
 */
export function thumbnailKey(mediaId: string, extension: ThumbnailExtension): string {
  const key = `${mediaId.slice(-2).toLowerCase()}/${mediaId.toLowerCase()}.${extension}`;
  if (!KEY_PATTERN.test(key)) {
    throw new UnsafeKeyError(key);
  }
  return key;
}

/** The absolute path of a thumbnail key inside the cache; refuses keys it did not build. */
export function thumbnailPath(folder: string, key: string): string {
  if (!KEY_PATTERN.test(key)) {
    throw new UnsafeKeyError(key);
  }
  return path.join(folder, ...key.split('/'));
}

export function thumbnailContentType(key: string): string {
  const extension = key.slice(key.lastIndexOf('.') + 1) as ThumbnailExtension;
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}
