import { timeAgo } from './relative-time';

describe('timeAgo', () => {
  const now = new Date('2026-09-26T12:00:00Z');
  const before = (ms: number) => new Date(now.getTime() - ms).toISOString();

  it('says how long ago, in the largest unit that fits', () => {
    expect(timeAgo(before(20_000), now)).toBe('just now');
    expect(timeAgo(before(5 * 60_000), now)).toBe('5 minutes ago');
    expect(timeAgo(before(3 * 3_600_000), now)).toBe('3 hours ago');
    expect(timeAgo(before(26 * 3_600_000), now)).toBe('yesterday');
    expect(timeAgo(before(15 * 24 * 3_600_000), now)).toBe('2 weeks ago');
  });

  it('gives nothing for a date it cannot read', () => {
    expect(timeAgo('not a date', now)).toBe('');
  });
});
