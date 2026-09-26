import { MESSAGE_EXCERPT_LENGTH, SEARCH_MAX_TERMS, type TextRange } from '@tam/shared';
import { cutText } from '../messages/message.mapper.js';

/** A word as search sees it: letters (with their accents) and digits. */
const WORD = /[\p{L}\p{M}\p{N}]+/gu;
/** Longer words are searched by their start. */
const MAX_TERM_LENGTH = 64;
/** How much of the text shows before a match found deep inside it. */
const LEAD_IN = 60;
const ELLIPSIS = '…';

/**
 * Lower case without accents, like PostgreSQL's `tam_simple` configuration (unaccent) compares
 * words: "Đường" and "duong" are the same word.
 */
export function foldForSearch(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'd').toLowerCase();
}

/** The words a query looks for, folded, without repeats, at most SEARCH_MAX_TERMS of them. */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  for (const [word] of query.normalize('NFC').matchAll(WORD)) {
    const term = foldForSearch(word).slice(0, MAX_TERM_LENGTH);
    if (term.length > 0 && !terms.includes(term)) {
      terms.push(term);
    }
    if (terms.length === SEARCH_MAX_TERMS) {
      break;
    }
  }
  return terms;
}

/**
 * A tsquery where every term is the start of a word ('bai':* & '2':*). Terms hold letters and
 * digits only, so they never need escaping.
 */
export function prefixQuery(terms: readonly string[]): string {
  return terms.map((term) => `'${term}':*`).join(' & ');
}

/** The same words matched whole ('bai' & '2'), which ranks exact words above longer ones. */
export function exactQuery(terms: readonly string[]): string {
  return terms.map((term) => `'${term}'`).join(' & ');
}

/** The words next to each other in the order typed ('bai' <-> '2'): "Bài 2" above "2 … bài". */
export function phraseQuery(terms: readonly string[]): string {
  return terms.map((term) => `'${term}'`).join(' <-> ');
}

/** The words of `text` that start with one of the terms: what a result highlights. */
export function findMatches(text: string, terms: readonly string[]): TextRange[] {
  if (terms.length === 0) {
    return [];
  }
  const ranges: TextRange[] = [];
  for (const match of text.matchAll(WORD)) {
    const word = foldForSearch(match[0]);
    if (terms.some((term) => word.startsWith(term))) {
      ranges.push([match.index, match[0].length]);
    }
  }
  return ranges;
}

/**
 * What a search result shows of a text: its start, or, when the first match lies beyond that, a
 * window opening shortly before the match (at a word boundary) behind "…". The ranges refer to the
 * returned excerpt.
 */
export function excerptAround(
  text: string,
  terms: readonly string[],
  length = MESSAGE_EXCERPT_LENGTH,
): { excerpt: string; matches: TextRange[] } {
  const matches = findMatches(text, terms);
  const first = matches[0];
  if (first === undefined || first[0] + first[1] <= length) {
    const excerpt = cutText(text, length);
    return { excerpt, matches: matches.filter(([at, size]) => at + size <= excerpt.length) };
  }
  let start = Math.max(0, first[0] - LEAD_IN);
  // Open at the next word boundary, never after the match itself.
  const boundary = text.slice(start, first[0]).search(/\s/);
  if (boundary >= 0) {
    start += boundary + 1;
  }
  if (/[\uDC00-\uDFFF]/.test(text.charAt(start))) {
    start += 1;
  }
  const excerpt = ELLIPSIS + cutText(text.slice(start), length - ELLIPSIS.length);
  const shift = ELLIPSIS.length - start;
  return {
    excerpt,
    matches: matches
      .map(([at, size]): TextRange => [at + shift, size])
      .filter(([at, size]) => at >= ELLIPSIS.length && at + size <= excerpt.length),
  };
}
