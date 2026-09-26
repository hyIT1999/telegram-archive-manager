import { SEARCH_MAX_TERMS } from '@tam/shared';
import { describe, expect, it } from 'vitest';
import {
  excerptAround,
  exactQuery,
  findMatches,
  foldForSearch,
  phraseQuery,
  prefixQuery,
  searchTerms,
} from '../../src/search/search-text.js';

describe('search words', () => {
  it('compares words without accents or case', () => {
    expect(foldForSearch('Đường Tiến Hóa')).toBe('duong tien hoa');
    expect(foldForSearch('Học'.normalize('NFD'))).toBe('hoc');
  });

  it('takes the distinct words of a query, at most eight', () => {
    expect(searchTerms('  Bài 2 — Tổng_hợp.mp4 bai ')).toEqual(['bai', '2', 'tong', 'hop', 'mp4']);
    expect(searchTerms('a b c d e f g h i j')).toHaveLength(SEARCH_MAX_TERMS);
    expect(searchTerms('#!?')).toEqual([]);
  });

  it('writes tsqueries that match word starts, whole words, or the words in order', () => {
    expect(prefixQuery(['bai', '2'])).toBe("'bai':* & '2':*");
    expect(exactQuery(['bai', '2'])).toBe("'bai' & '2'");
    expect(phraseQuery(['bai', '2'])).toBe("'bai' <-> '2'");
  });
});

describe('highlights', () => {
  it('marks every word that starts with a search word', () => {
    const name = 'Buổi_10_Optics_logic.mp4';
    const ranges = findMatches(name, searchTerms('buoi opt'));
    expect(ranges.map(([at, length]) => name.slice(at, at + length))).toEqual(['Buổi', 'Optics']);
    // Decomposed text keeps its accents inside the word.
    const nfd = 'Bài học'.normalize('NFD');
    expect(findMatches(nfd, ['hoc'])).toEqual([[nfd.indexOf('h'), nfd.length - nfd.indexOf('h')]]);
    expect(findMatches(name, [])).toEqual([]);
  });

  it('shows the start of a text when the words are found there', () => {
    const { excerpt, matches } = excerptAround('Candles explained simply', ['expl'], 20);
    expect(excerpt).toBe('Candles explained si');
    expect(matches).toEqual([[8, 9]]);
  });

  it('opens the excerpt shortly before a match found deep in a long text', () => {
    const text = `${'intro words '.repeat(60)}the needle is here and the rest`;
    const { excerpt, matches } = excerptAround(text, ['needle'], 100);
    expect(excerpt.startsWith('…')).toBe(true);
    expect(excerpt.length).toBeLessThanOrEqual(100);
    const [at, length] = matches[0] ?? [0, 0];
    expect(excerpt.slice(at, at + length)).toBe('needle');
    // The window opens at a word boundary.
    expect(excerpt.charAt(1)).not.toBe(' ');
    expect(/^…(intro|words|the)/.test(excerpt)).toBe(true);
  });

  it('never cuts an emoji in two', () => {
    const text = `${'x'.repeat(98)}😀 needle`;
    expect(excerptAround(text, ['zzz'], 99).excerpt).toBe('x'.repeat(98));
  });
});
