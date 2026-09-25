/**
 * MIME types browsers may show inline. Everything else (HTML, SVG, XML, scripts, archives…) is
 * sent as a download, so a file from a chat can never run in the archive's origin.
 */
const INLINE_TYPES =
  /^(image\/(jpeg|png|gif|webp|avif)|video\/(mp4|webm)|audio\/[\w.+-]+|application\/pdf)$/;

export function isInlineType(mimeType: string): boolean {
  return INLINE_TYPES.test(mimeType.toLowerCase());
}

/**
 * `inline` or `attachment` with the file name for every browser: an ASCII fallback in
 * `filename` and the exact name in `filename*` (RFC 5987/6266).
 */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  // "Bài giảng" → "Bai giang" for browsers that only read the ASCII name.
  const fallback = fileName
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${kind}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
