/** File extensions (without the dot) for the MIME types Telegram files usually carry. */
const EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/heic': 'heic',
  'image/bmp': 'bmp',
  'image/tiff': 'tiff',
  'image/svg+xml': 'svg',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-matroska': 'mkv',
  'video/x-msvideo': 'avi',
  'video/mpeg': 'mpg',
  'video/3gpp': '3gp',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/x-flac': 'flac',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/vnd.rar': 'rar',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'application/gzip': 'gz',
  'application/epub+zip': 'epub',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/json': 'json',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'text/html': 'html',
  'application/x-tgsticker': 'tgs',
  'application/vnd.android.package-archive': 'apk',
};

/** What Telegram sends when a file has no MIME type of its own, per media type. */
const MEDIA_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  PHOTO: 'jpg',
  VIDEO: 'mp4',
  ANIMATION: 'mp4',
  VIDEO_NOTE: 'mp4',
  VOICE: 'ogg',
  STICKER: 'webp',
};

/**
 * The extension a stored file gets when Telegram gave it no name (photos, voice notes, round
 * videos): from its MIME type, else from its media type; null when neither says.
 */
export function extensionFor(
  mimeType: string | null | undefined,
  mediaType?: string | null,
): string | null {
  const essence = mimeType?.split(';')[0]?.trim().toLowerCase();
  const known = essence ? EXTENSIONS[essence] : undefined;
  return known ?? (mediaType ? (MEDIA_TYPE_EXTENSIONS[mediaType] ?? null) : null);
}
