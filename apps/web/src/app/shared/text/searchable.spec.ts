import { searchable, startsWords } from './searchable';

describe('searchable text', () => {
  it('compares without accents or case', () => {
    expect(searchable('Đường Tiến Hóa')).toBe('duong tien hoa');
  });

  it('finds names by the start of their words', () => {
    expect(startsWords('Smoke tag A', 'smoke a')).toBe(true);
    expect(startsWords('Bài học cuối', 'hoc cuoi')).toBe(true);
    expect(startsWords('Optics_02 Lens', 'lens opt')).toBe(true);
    expect(startsWords('Optics', 'tics')).toBe(false);
    expect(startsWords('Smoke tag A', 'smoke b')).toBe(false);
    expect(startsWords('anything', '  ')).toBe(true);
  });
});
