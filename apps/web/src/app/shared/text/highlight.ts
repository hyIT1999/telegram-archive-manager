import type { TextRange } from '../models';

/** A piece of a text, marked when a search found it there. */
export interface TextPart {
  readonly text: string;
  readonly marked: boolean;
}

/**
 * Cuts a text at the ranges a search found. Ranges may come in any order and overlap; the parts
 * of them outside the text are left out.
 */
export function highlightParts(
  text: string,
  ranges: readonly TextRange[] | null | undefined,
): TextPart[] {
  const spans = (ranges ?? [])
    .map(([at, length]): [number, number] => [Math.max(0, at), Math.min(text.length, at + length)])
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const parts: { text: string; marked: boolean }[] = [];
  let done = 0;
  for (const [start, end] of spans) {
    if (end <= done) {
      continue;
    }
    const from = Math.max(start, done);
    const previous = parts.at(-1);
    if (from > done) {
      parts.push({ text: text.slice(done, from), marked: false });
    } else if (previous?.marked) {
      // Touching or overlapping ranges make one mark.
      previous.text += text.slice(from, end);
      done = end;
      continue;
    }
    parts.push({ text: text.slice(from, end), marked: true });
    done = end;
  }
  if (done < text.length) {
    parts.push({ text: text.slice(done), marked: false });
  }
  return parts;
}
