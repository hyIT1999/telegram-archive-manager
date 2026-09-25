/** Inclusive byte range of a file. */
export interface ByteRange {
  start: number;
  end: number;
}

/**
 * Reads a `Range: bytes=…` header for a file of `size` bytes. Null when there is no single range
 * to honour (no header, another unit, several ranges): the whole file is sent. 'unsatisfiable'
 * when the range lies outside the file (416).
 */
export function parseByteRange(
  header: string | undefined,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }
  if (match[1] === '') {
    const suffix = Number(match[2]);
    if (suffix === 0 || size === 0) {
      return 'unsatisfiable';
    }
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  if (start >= size || start > end) {
    return 'unsatisfiable';
  }
  return { start, end };
}
