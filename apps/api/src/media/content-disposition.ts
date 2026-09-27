/**
 * MIME types browsers may show inline. Everything else (HTML, SVG, XML, scripts, archives…) is
 * sent as a download, so a file from a chat can never run in the archive's origin.
 */
const INLINE_TYPES =
  /^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm)|audio\/[\w.+-]+|application\/pdf)$/;

export function isInlineType(mimeType: string): boolean {
  const type = mimeType.toLowerCase();
  // XML can carry scripts (e.g. an "audio/…+xml" playlist); it always downloads.
  return INLINE_TYPES.test(type) && !type.includes('xml');
}

/**
 * Control characters and the Unicode bidi controls that can reverse how a name reads
 * ("invoice‮fdp.exe" shows as "invoiceexe.pdf").
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const UNSAFE_NAME_CHARACTERS = /[\u0000-\u001f\u007f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;

/**
 * `inline` or `attachment` with the file name for every browser: an ASCII fallback in
 * `filename` and the exact name in `filename*` (RFC 5987/6266).
 */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const name = fileName.replace(UNSAFE_NAME_CHARACTERS, '') || 'file';
  // "Bài giảng" → "Bai giang" for browsers that only read the ASCII name.
  const fallback = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
