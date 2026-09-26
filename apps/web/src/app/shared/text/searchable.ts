/** Lower case without accents, so "bai hoc" finds "Bài học". */
export function searchable(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

function words(text: string): string[] {
  return searchable(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);
}

/**
 * Whether every word typed starts a word of `text`, without accents or case, like the archive
 * search: "smoke a" finds "Smoke tag A", "hoc" finds "Bài học". Nothing typed finds everything.
 */
export function startsWords(text: string, typed: string): boolean {
  const wanted = words(typed);
  if (wanted.length === 0) {
    return true;
  }
  const available = words(text);
  return wanted.every((part) => available.some((word) => word.startsWith(part)));
}
