/** How the archive can show a file in the browser. */
export type ViewerKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';

function essence(mimeType: string | null | undefined): string {
  return (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

/**
 * Chosen by MIME type rather than by Telegram's media type: a photo sent "as a file" is a document
 * whose MIME type still says image/jpeg.
 */
export function viewerKind(mimeType: string | null | undefined): ViewerKind {
  const type = essence(mimeType);
  if (type === 'application/pdf') {
    return 'pdf';
  }
  if (type.startsWith('image/')) {
    return 'image';
  }
  if (type.startsWith('video/')) {
    return 'video';
  }
  if (type.startsWith('audio/')) {
    return 'audio';
  }
  return 'file';
}

/** "4:05" or "1:02:03"; null when unknown. */
export function durationLabel(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, '0');
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${rest}` : `${minutes}:${rest}`;
}

export function fileExtension(fileName: string | null | undefined): string | null {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(fileName ?? '');
  return match?.[1]?.toLowerCase() ?? null;
}

interface FileKind {
  readonly label: string;
  readonly icon: string;
}

const KINDS: readonly { mime: RegExp; extensions: readonly string[]; kind: FileKind }[] = [
  {
    mime: /^application\/pdf$/,
    extensions: ['pdf'],
    kind: { label: 'PDF document', icon: 'picture_as_pdf' },
  },
  {
    mime: /(msword|wordprocessingml|rtf|opendocument\.text)/,
    extensions: ['doc', 'docx', 'rtf', 'odt'],
    kind: { label: 'Word document', icon: 'description' },
  },
  {
    mime: /(ms-excel|spreadsheetml|opendocument\.spreadsheet|text\/csv)/,
    extensions: ['xls', 'xlsx', 'ods', 'csv'],
    kind: { label: 'Spreadsheet', icon: 'table_chart' },
  },
  {
    mime: /(ms-powerpoint|presentationml|opendocument\.presentation)/,
    extensions: ['ppt', 'pptx', 'odp'],
    kind: { label: 'Presentation', icon: 'slideshow' },
  },
  {
    mime: /(zip|rar|7z|gzip|x-tar)/,
    extensions: ['zip', 'rar', '7z', 'gz', 'tar'],
    kind: { label: 'Archive', icon: 'folder_zip' },
  },
  { mime: /epub/, extensions: ['epub'], kind: { label: 'E-book', icon: 'menu_book' } },
  {
    mime: /android\.package-archive/,
    extensions: ['apk'],
    kind: { label: 'Android app', icon: 'android' },
  },
  { mime: /^text\/plain$/, extensions: ['txt'], kind: { label: 'Text file', icon: 'article' } },
  { mime: /^video\//, extensions: [], kind: { label: 'Video', icon: 'movie' } },
  { mime: /^audio\//, extensions: [], kind: { label: 'Audio', icon: 'music_note' } },
  { mime: /^image\//, extensions: [], kind: { label: 'Image', icon: 'image' } },
];

/** What kind of file it is, for people ("PDF document") and as an icon. */
export function fileKind(
  mimeType: string | null | undefined,
  fileName: string | null | undefined,
): FileKind {
  const type = essence(mimeType);
  const extension = fileExtension(fileName);
  const known = KINDS.find(
    (candidate) =>
      (type !== '' && candidate.mime.test(type)) ||
      (extension !== null && candidate.extensions.includes(extension)),
  );
  if (known) {
    return known.kind;
  }
  return { label: extension ? `${extension.toUpperCase()} file` : 'File', icon: 'draft' };
}
