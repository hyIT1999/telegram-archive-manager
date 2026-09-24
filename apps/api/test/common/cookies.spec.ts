import { describe, expect, it } from 'vitest';
import { readCookie } from '../../src/common/http/cookies.js';

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    expect(readCookie('theme=dark; tam_sid=abc123; lang=vi', 'tam_sid')).toBe('abc123');
    expect(readCookie('tam_sid=abc123', 'tam_sid')).toBe('abc123');
  });

  it('returns undefined when the header or the cookie is missing', () => {
    expect(readCookie(undefined, 'tam_sid')).toBeUndefined();
    expect(readCookie('', 'tam_sid')).toBeUndefined();
    expect(readCookie('xtam_sid=1; tam_sid_old=2', 'tam_sid')).toBeUndefined();
  });

  it('uses the first occurrence, as browsers send the most specific path first', () => {
    expect(readCookie('tam_sid=first; tam_sid=second', 'tam_sid')).toBe('first');
  });

  it('unquotes and percent-decodes values, keeping undecodable ones raw', () => {
    expect(readCookie('a="quoted value"', 'a')).toBe('quoted value');
    expect(readCookie('a=x%20y', 'a')).toBe('x y');
    expect(readCookie('a=100%', 'a')).toBe('100%');
    expect(readCookie('a=b=c', 'a')).toBe('b=c');
  });

  it('skips malformed pairs', () => {
    expect(readCookie('garbage; ; tam_sid=ok', 'tam_sid')).toBe('ok');
  });
});
